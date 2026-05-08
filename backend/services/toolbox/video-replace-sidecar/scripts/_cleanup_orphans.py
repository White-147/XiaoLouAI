"""One-shot helper: exercise proc_utils.kill_process_tree on known orphan PIDs.

Used once to clean up the 01:13 zombie Wan2.1 subprocesses (PIDs 41856 + 7408)
that were pinning ~11 GB of VRAM. Safe to re-run — a missing PID is a no-op.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.workers.proc_utils import is_process_running, kill_process_tree  # noqa: E402


def main(pids: list[int]) -> None:
    for p in pids:
        print(f"before pid={p} alive={is_process_running(p)}")
        kill_process_tree(p, reason="manual cleanup of orphan VACE subprocess")
        print(f"after  pid={p} alive={is_process_running(p)}")


if __name__ == "__main__":
    args = [int(x) for x in sys.argv[1:]]
    main(args or [41856, 7408])
