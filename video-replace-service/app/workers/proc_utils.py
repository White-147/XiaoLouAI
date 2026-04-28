"""Cross-platform process-tree helpers.

Centralises the logic for killing a subprocess together with *all* of its
descendants — critical on Windows, where a hung Wan2.1 ``generate.py`` child
spawns the base interpreter via the venv redirector and pins ~11 GB of VRAM
until the entire tree is torn down.

`asyncio.subprocess.Process.kill()` only targets the immediate child, which
historically let the `Python312\\python.exe` grandchild go on running even
after the FastAPI service itself exited. This module standardises a "nuke
the whole tree" primitive used by:

  * `vace_replacer.run_replacement_async` on timeout / cancellation / error
  * `main.py` lifespan for startup zombie reap and shutdown cleanup
"""
from __future__ import annotations

import logging
import os
import signal
import subprocess
from typing import Iterable

logger = logging.getLogger(__name__)


def is_process_running(pid: int | None) -> bool:
    """Return True iff ``pid`` refers to a live process right now."""
    if not pid or pid <= 0:
        return False
    try:
        import psutil
    except ImportError:
        # Fallback: POSIX kill(pid, 0) / Windows OpenProcess via os.kill
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    try:
        proc = psutil.Process(pid)
        return proc.is_running() and proc.status() != psutil.STATUS_ZOMBIE
    except Exception:
        return False


def _psutil_kill_tree(pid: int, timeout: float) -> bool:
    """Kill the process tree rooted at `pid` using psutil. Returns True on success."""
    try:
        import psutil
    except ImportError:
        return False

    try:
        parent = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("[proc-utils] cannot open pid=%s via psutil: %s", pid, exc)
        return False

    try:
        children = parent.children(recursive=True)
    except Exception:
        children = []

    procs: list = [parent] + list(children)
    logger.info("[proc-utils] killing tree root=%s descendants=%s",
                pid, [getattr(c, "pid", "?") for c in children])

    for p in procs:
        try:
            p.terminate()
        except Exception:
            pass
    try:
        _, alive = psutil.wait_procs(procs, timeout=timeout)
    except Exception:
        alive = procs
    for p in alive:
        try:
            p.kill()
        except Exception:
            pass
    try:
        psutil.wait_procs(alive, timeout=2.0)
    except Exception:
        pass
    return True


def _fallback_kill_tree(pid: int) -> None:
    """Best-effort OS-native fallback when psutil is not importable."""
    if os.name == "nt":
        try:
            run_kwargs = {
                "check": False,
                "capture_output": True,
                "timeout": 10,
            }
            if hasattr(subprocess, "CREATE_NO_WINDOW"):
                run_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                **run_kwargs,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[proc-utils] taskkill /T /F failed for %s: %s", pid, exc)
    else:
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except Exception:
            try:
                os.kill(pid, signal.SIGKILL)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[proc-utils] kill(%s) failed: %s", pid, exc)


def kill_process_tree(pid: int | None, *, timeout: float = 10.0, reason: str = "") -> None:
    """Forcefully terminate ``pid`` and every descendant.

    * Windows: prefers ``psutil`` walking of the parent/child graph; falls back
      to ``taskkill /T /F`` which also descends children.
    * POSIX: prefers ``psutil``; falls back to ``killpg`` on the session, or
      a bare ``SIGKILL`` if the child was not started as a session leader.

    Safe to call with ``None`` / a stale PID — it is a no-op in that case.
    Never raises.
    """
    if not pid or pid <= 0:
        return
    if not is_process_running(pid):
        logger.info("[proc-utils] pid=%s already gone, nothing to kill (%s)", pid, reason)
        return
    logger.warning("[proc-utils] killing process tree pid=%s (%s)", pid, reason)
    if _psutil_kill_tree(pid, timeout):
        return
    _fallback_kill_tree(pid)


def kill_many_trees(pids: Iterable[int | None], *, reason: str = "") -> None:
    for pid in pids:
        try:
            kill_process_tree(pid, reason=reason)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[proc-utils] kill_process_tree(%s) raised: %s", pid, exc)
