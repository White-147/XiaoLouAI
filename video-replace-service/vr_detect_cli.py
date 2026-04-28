"""
vr_detect_cli.py — run YOLO person detection for a VR job, no HTTP server.

Usage (run from video-replace-service/ with venv Python):
  python vr_detect_cli.py <job_id> [--conf 0.4]

The runner writes results directly into tasks.sqlite; no stdout output is
needed for the caller beyond the exit code.

Exit codes: 0 = success, 1 = job/detection error, 2 = unexpected error.
"""
import argparse
import asyncio
import json
import os
import sys
import traceback
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent
os.chdir(SERVICE_DIR)
sys.path.insert(0, str(SERVICE_DIR))


async def _run(job_id: str, conf: float) -> None:
    from app.config import get_settings
    from app.services.job_runner import DetectionRunner
    from app.services.storage import Storage
    from app.services.tasks_db import TasksDB

    settings = get_settings()
    db = TasksDB(settings.database_url)
    await db.init()
    storage = Storage(settings)

    runner = DetectionRunner(settings, storage, db)
    await runner.run(job_id, yolo_conf=conf)


def main() -> None:
    parser = argparse.ArgumentParser(description="YOLO detection CLI for VR jobs")
    parser.add_argument("job_id")
    parser.add_argument("--conf", type=float, default=0.4)
    args = parser.parse_args()

    try:
        asyncio.run(_run(args.job_id, args.conf))
        print(json.dumps({"ok": True}), flush=True)
    except LookupError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc), "traceback": traceback.format_exc()}),
              flush=True)
        sys.exit(2)


if __name__ == "__main__":
    main()
