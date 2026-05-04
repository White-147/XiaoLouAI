"""
⚠ LEGACY FastAPI entrypoint — NOT part of the default architecture.

As of 2026-04, the default video-replace pipeline terminates in
``core-api`` at port 4100 (see ``core-api/src/video-replace-native.js``).
Python is invoked on-demand as ``vr_probe_cli.py`` / ``vr_detect_cli.py`` /
``vr_pipeline_cli.py`` subprocesses.

This module remains for local debugging / profiling of the FastAPI-only
variant. To start it you must explicitly set
``VR_LEGACY_STANDALONE=1`` — otherwise ``run_api.py`` refuses to bind.

Do NOT use this in production and do NOT start it alongside the default
4100-native stack: both paths share ``video_replace_jobs`` and would race to
reap each other's in-flight jobs.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routers.video_replace import router as video_replace_router
from .schemas import JobStage

logger = logging.getLogger(__name__)

logger.warning(
    "[LEGACY] app.main is the FastAPI sidecar variant (port 4200). "
    "The default stack is core-api 4100-native; this module is debug-only. "
    "See video-replace-service/app/main.py top-of-file banner."
)

# Stages that represent "work in progress" from a previous service lifetime.
# These are never safe to resume because the in-memory worker queue and any
# GPU subprocesses died with the service — the only sane thing is to reap.
_IN_FLIGHT_STAGES: list[str] = [
    JobStage.QUEUED.value,
    JobStage.TRACKING.value,
    JobStage.MASK_READY.value,
    JobStage.REPLACING.value,
]

# Module-level ref so lifespan can cancel the worker task on shutdown.
_worker_task: asyncio.Task | None = None


async def _reap_abandoned_jobs(db) -> int:
    """Kill any leftover GPU subprocesses from a previous run and mark their
    jobs as failed.

    Returns the number of reaped jobs. Never raises.
    """
    from .workers.proc_utils import kill_process_tree

    try:
        abandoned = await db.list_in_stages(_IN_FLIGHT_STAGES)
    except Exception as exc:  # noqa: BLE001
        logger.error("[lifespan] could not scan for abandoned jobs: %s", exc)
        return 0

    if not abandoned:
        logger.info("[lifespan] startup zombie scan: no in-flight jobs")
        return 0

    logger.warning(
        "[lifespan] startup zombie scan: reaping %d abandoned job(s) in stages=%s",
        len(abandoned), _IN_FLIGHT_STAGES,
    )

    reaped = 0
    for job in abandoned:
        job_id = job.get("job_id")
        data = job.get("data") or {}
        pid = data.get("subprocess_pid")
        if pid:
            try:
                kill_process_tree(int(pid), reason=f"startup-reap job={job_id}")
            except Exception as exc:  # noqa: BLE001
                logger.warning("[lifespan] could not kill pid=%s for job=%s: %s", pid, job_id, exc)
        try:
            await db.update(
                job_id,
                stage=JobStage.FAILED,
                error=(
                    "服务重启时发现该任务处于未完成状态。"
                    "关联的 GPU 子进程（如存在）已被清理，请重新提交。"
                ),
                message="任务被服务重启流程中止",
                data_patch={"subprocess_pid": None},
            )
            reaped += 1
        except Exception as exc:  # noqa: BLE001
            logger.error("[lifespan] could not mark job=%s failed: %s", job_id, exc)

    logger.warning("[lifespan] startup zombie scan: reaped %d job(s)", reaped)
    return reaped


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _worker_task
    settings = get_settings()

    from .services.tasks_db import TasksDB
    db = TasksDB(settings.database_url)
    await db.init()

    await _reap_abandoned_jobs(db)

    from .deps import get_storage
    from .services.replace_runner import ReplaceRunner
    from .workers.queue import current_state, worker_loop

    storage = get_storage(settings)
    runner = ReplaceRunner(settings=settings, storage=storage, db=db)

    _worker_task = asyncio.create_task(
        worker_loop(runner),
        name="replace-worker-loop",
    )
    logger.info("[main] replace worker loop started")

    try:
        yield
    finally:
        # Snapshot whatever is currently running so we can kill its subprocess
        # tree even if the worker task raises while being cancelled.
        in_flight_job = current_state.job_id
        in_flight_pids = current_state.all_pids

        if _worker_task and not _worker_task.done():
            _worker_task.cancel()
            try:
                await asyncio.wait_for(_worker_task, timeout=15)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
            except Exception as exc:  # noqa: BLE001
                logger.warning("[main] worker task raised on shutdown: %s", exc)

        if in_flight_pids:
            logger.warning(
                "[main] shutdown: killing %d in-flight subprocess tree(s) for job=%s",
                len(in_flight_pids), in_flight_job,
            )
            from .workers.proc_utils import kill_many_trees
            kill_many_trees(in_flight_pids, reason=f"shutdown in-flight job={in_flight_job}")

        if in_flight_job:
            try:
                await db.update(
                    in_flight_job,
                    stage=JobStage.FAILED,
                    error="服务停止时任务仍在执行；关联的 GPU 子进程已被清理。",
                    message="服务退出中断了此任务",
                    data_patch={"subprocess_pid": None},
                )
            except Exception:
                pass

        logger.info("[main] replace worker loop stopped")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="XIAOLOU · Video Replace Service",
        version="0.3.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Static file mounts — all prefixed with `vr-` to avoid collision with
    # core-api's `/uploads/` etc. when both are proxied from the same origin.
    _mounts = [
        ("/vr-uploads",    settings.upload_dir,    "vr-uploads"),
        ("/vr-thumbnails", settings.thumbnail_dir,  "vr-thumbnails"),
        ("/vr-candidates", settings.candidate_dir,  "vr-candidates"),
        ("/vr-keyframes",  settings.keyframe_dir,   "vr-keyframes"),
        ("/vr-references", settings.reference_dir,  "vr-references"),
        ("/vr-masks",      settings.mask_dir,       "vr-masks"),
        ("/vr-results",    settings.result_dir,     "vr-results"),
        ("/vr-finals",     settings.final_dir,      "vr-finals"),
    ]
    for url_path, dir_path, name in _mounts:
        dir_path.mkdir(parents=True, exist_ok=True)
        app.mount(
            url_path,
            StaticFiles(directory=str(dir_path), check_dir=True),
            name=name,
        )

    app.include_router(video_replace_router)

    @app.get("/healthz")
    async def healthz():
        return {"ok": True, "service": "video-replace", "version": "0.3.0"}

    return app


app = create_app()
