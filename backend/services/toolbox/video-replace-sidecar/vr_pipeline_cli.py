"""
vr_pipeline_cli.py — run the full SAM2+VACE replace pipeline, no HTTP server.

Usage (run from video-replace-service/ with venv Python):
  python vr_pipeline_cli.py <job_id>

The runner writes progress directly into PostgreSQL.  Callers should NOT
wait for this process — core-api (4100) spawns it detached and watches for
stage transitions via the same PostgreSQL table.

Exit codes:
  0   pipeline finished (job may be succeeded OR failed in DB)
  2   unexpected startup error (job not found, settings broken, etc.)
  130 cancelled via SIGINT / SIGTERM
"""
import asyncio
import json
import os
import signal
import sys
import traceback
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent
os.chdir(SERVICE_DIR)
sys.path.insert(0, str(SERVICE_DIR))


async def _run(job_id: str) -> None:
    from app.config import get_settings
    from app.services.replace_runner import ReplaceRunner
    from app.services.storage import Storage
    from app.services.tasks_db import TasksDB

    settings = get_settings()
    db = TasksDB(settings.database_url)
    await db.init()
    storage = Storage(settings)

    # Publish the pipeline PID (our own process) on stdout as the very first
    # JSON line so the Node parent can persist it into PostgreSQL before
    # any VACE subprocess spawns. If the pipeline later crashes we can still
    # kill the tree from a fresh core-api boot.
    print(json.dumps({"type": "pipeline_ready", "pid": os.getpid(), "job_id": job_id}),
          flush=True)

    runner = ReplaceRunner(settings, storage, db)
    await runner.run_queued(job_id)


def _install_signal_handlers(loop: asyncio.AbstractEventLoop) -> None:
    """Best-effort: convert SIGINT/SIGTERM into a task cancellation so the
    replace_runner's ``finally`` block has a chance to kill the VACE
    subprocess tree before we exit.

    On Windows ``loop.add_signal_handler`` is not supported — we fall back
    to the default signal handlers and rely on core-api (Node) killing the
    whole process tree via ``taskkill /T /F``.
    """
    if os.name == "nt":
        return
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _on_cancel, loop)
        except NotImplementedError:
            pass


def _on_cancel(loop: asyncio.AbstractEventLoop) -> None:
    for task in asyncio.all_tasks(loop):
        task.cancel()


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: vr_pipeline_cli.py <job_id>"}),
              flush=True)
        sys.exit(2)

    job_id = sys.argv[1]

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        _install_signal_handlers(loop)
        try:
            loop.run_until_complete(_run(job_id))
        finally:
            try:
                loop.close()
            except Exception:
                pass
        print(json.dumps({"ok": True, "job_id": job_id}), flush=True)
    except KeyboardInterrupt:
        print(json.dumps({"ok": False, "error": "cancelled (SIGINT)", "job_id": job_id}),
              flush=True)
        sys.exit(130)
    except asyncio.CancelledError:
        print(json.dumps({"ok": False, "error": "cancelled", "job_id": job_id}),
              flush=True)
        sys.exit(130)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc), "traceback": traceback.format_exc()}),
              flush=True)
        sys.exit(2)


if __name__ == "__main__":
    main()
