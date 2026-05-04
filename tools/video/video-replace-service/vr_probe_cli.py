"""
vr_probe_cli.py — video probe + thumbnail extraction, no HTTP server.

Usage (run from video-replace-service/ with venv Python):
  python vr_probe_cli.py <video_path> <thumb_path>

Outputs a single JSON line to stdout:
  {"ok": true,  "meta": {...}, "thumb_ok": true}
  {"ok": false, "error": "..."}

Exit codes: 0 = success, 1 = video error, 2 = unexpected error.
"""
import json
import os
import sys
import traceback
from pathlib import Path

# Resolve service directory from script location, then chdir so that
# relative .env.local / ./data paths in pydantic-settings resolve correctly.
SERVICE_DIR = Path(__file__).resolve().parent
os.chdir(SERVICE_DIR)
sys.path.insert(0, str(SERVICE_DIR))


def main() -> None:
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: vr_probe_cli.py <video_path> <thumb_path>"}))
        sys.exit(2)

    video_path = Path(sys.argv[1])
    thumb_path = Path(sys.argv[2])

    try:
        from app.services.video import VideoError, make_thumbnail, probe

        meta = probe(video_path)
        result: dict = {"ok": True, "meta": meta.model_dump()}

        try:
            thumb_path.parent.mkdir(parents=True, exist_ok=True)
            make_thumbnail(video_path, thumb_path, short_edge=360)
            result["thumb_ok"] = True
        except VideoError as exc:
            result["thumb_ok"] = False
            result["thumb_error"] = str(exc)

        print(json.dumps(result), flush=True)

    except Exception as exc:  # noqa: BLE001
        is_video_error = type(exc).__name__ == "VideoError"
        print(json.dumps({"ok": False, "error": str(exc), "traceback": traceback.format_exc()}),
              flush=True)
        sys.exit(1 if is_video_error else 2)


if __name__ == "__main__":
    main()
