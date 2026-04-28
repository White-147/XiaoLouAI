"""Dev entrypoint for the LEGACY 4200 FastAPI variant.

⚠ NOT part of the default architecture. The production stack is:

    browser (3000) → core-api (4100, Node, native) → Python CLI subprocesses

which does NOT require a FastAPI HTTP listener. This script starts the
FastAPI-on-4200 variant for local debugging / A-B testing only and refuses
to run unless ``VR_LEGACY_STANDALONE=1`` is set, so that an accidental
``python run_api.py`` cannot clash with core-api (both paths share
tasks.sqlite and would race each other's startup reconcile).

Usage (debug only):

    set VR_LEGACY_STANDALONE=1
    python run_api.py
"""
from __future__ import annotations

import os
import sys


def _main() -> None:
    if os.environ.get("VR_LEGACY_STANDALONE") != "1":
        sys.stderr.write(
            "[run_api.py] refusing to start the legacy 4200 FastAPI variant.\n"
            "This is not the default architecture. The default stack is\n"
            "  browser (3000) -> core-api (4100) -> Python CLI subprocesses\n"
            "managed by core-api/src/video-replace-native.js.\n\n"
            "If you really need the standalone FastAPI for debugging, re-run with:\n"
            "  set VR_LEGACY_STANDALONE=1\n"
            "  python run_api.py\n"
            "and make sure core-api (4100) is NOT running, otherwise the two paths\n"
            "will race to reap each other's jobs via tasks.sqlite.\n"
        )
        sys.exit(2)

    import uvicorn
    from app.config import get_settings

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)


if __name__ == "__main__":
    _main()
