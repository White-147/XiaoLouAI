"""In-process async queue for replacement jobs.

Singleton queue created at import time; drained by a single background
asyncio.Task started in app/main.py lifespan.  No Redis / ARQ required.

In addition to the plain queue, this module also exposes ``current_state``
so the lifespan shutdown hook can reap whatever job is in flight (including
the PID of any GPU subprocess it spawned). Without that, a server-stop in
the middle of a VACE run would leave a multi-gigabyte Wan2.1 grandchild
orphaned on the GPU — the exact zombie scenario this refactor targets.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from ..schemas import JobStage

logger = logging.getLogger(__name__)

# Module-level singleton — imported by both router (to enqueue) and main.py
# (to start the drain task).
replace_queue: asyncio.Queue[str] = asyncio.Queue(maxsize=100)


@dataclass
class _CurrentState:
    """Shared view of whatever replacement job is running right now.

    Mutated only by ``worker_loop`` and by the VACE subprocess's PID callback
    via ``set_active_pid``. Read by the lifespan shutdown hook.
    """
    job_id: str | None = None
    # PID of the outermost child spawned by vace_replacer (on Windows the
    # venv redirector; the base-interpreter grandchild is killed via the
    # process tree walker).
    active_pid: int | None = None
    _pids: list[int] = field(default_factory=list)

    def begin(self, job_id: str) -> None:
        self.job_id = job_id
        self.active_pid = None
        self._pids = []

    def set_active_pid(self, pid: int) -> None:
        self.active_pid = pid
        if pid not in self._pids:
            self._pids.append(pid)

    def end(self) -> None:
        self.job_id = None
        self.active_pid = None
        self._pids = []

    @property
    def all_pids(self) -> list[int]:
        return list(self._pids)


current_state = _CurrentState()


async def enqueue(job_id: str) -> None:
    """Add a job_id to the replacement queue (non-blocking; raises QueueFull if full)."""
    await replace_queue.put(job_id)


async def worker_loop(runner) -> None:  # type: ignore[type-arg]
    """
    Drain replace_queue serially — one replacement job at a time.

    The runner is responsible for all stage transitions and error handling.
    If the runner raises, we mark the job FAILED and continue to the next item.

    On ``CancelledError`` (service shutdown) we propagate cancellation into
    ``runner.run``; the runner's vace_replacer finally-block will tear down
    the GPU subprocess tree before we return.
    """
    logger.info("[replace-queue] worker loop started")
    while True:
        try:
            job_id = await replace_queue.get()
        except asyncio.CancelledError:
            logger.info("[replace-queue] worker loop cancelled while idle")
            raise
        current_state.begin(job_id)
        try:
            logger.info("[replace-queue] starting job %s", job_id)
            await runner.run(job_id)
            logger.info("[replace-queue] finished job %s", job_id)
        except asyncio.CancelledError:
            logger.warning("[replace-queue] job %s cancelled (shutdown)", job_id)
            try:
                await runner.db.update(
                    job_id,
                    stage=JobStage.FAILED,
                    error="服务退出，任务被中断。重启后请重新提交。",
                    message="任务在执行中被服务重启中断",
                )
            except Exception:
                pass
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("[replace-queue] job %s raised unhandled: %s", job_id, exc)
            # Best-effort: mark the job FAILED so it doesn't stay queued forever.
            try:
                await runner.db.update(
                    job_id,
                    stage=JobStage.FAILED,
                    error=f"内部错误（未捕获）: {exc}",
                    message="任务执行时发生未预期的错误",
                )
            except Exception:  # noqa: BLE001
                pass
        finally:
            current_state.end()
            replace_queue.task_done()
