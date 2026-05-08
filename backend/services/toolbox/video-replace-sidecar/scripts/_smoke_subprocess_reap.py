"""Smoke-test for the subprocess timeout + process-tree kill path.

Mimics vace_replacer.run_replacement_async's supervisor loop using a harmless
sleeping Python child that itself spawns a grandchild — the same shape as
the real venv-redirector → base-interpreter chain on Windows. Verifies that:

  1. The supervisor respects idle_timeout and triggers a kill.
  2. kill_process_tree kills *both* the child and its grandchild.
  3. After cleanup, no PID from the tree remains.

Run with:  .venv\\Scripts\\python.exe scripts\\_smoke_subprocess_reap.py
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.workers.proc_utils import is_process_running, kill_process_tree

# A tiny parent that spawns a sleeping grandchild then sleeps itself,
# intentionally producing no stdout so the idle watchdog fires quickly.
CHILD_SCRIPT = r"""
import subprocess, sys, time, os
p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])
print(f"GRANDCHILD_PID={p.pid}", flush=True)
time.sleep(600)
"""


async def main() -> int:
    spawn_kwargs: dict = {}
    if os.name == "nt":
        spawn_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        spawn_kwargs["start_new_session"] = True

    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-c", CHILD_SCRIPT,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        **spawn_kwargs,
    )
    child_pid = proc.pid

    # Read one line to discover the grandchild PID.
    line = await asyncio.wait_for(proc.stdout.readline(), timeout=10)
    line_text = line.decode("utf-8", errors="replace").strip()
    assert "GRANDCHILD_PID=" in line_text, f"unexpected: {line_text!r}"
    grandchild_pid = int(line_text.split("=", 1)[1])

    print(f"[smoke] parent pid={child_pid} grandchild pid={grandchild_pid}")
    print(f"[smoke] parent alive={is_process_running(child_pid)} "
          f"grandchild alive={is_process_running(grandchild_pid)}")

    # Simulate idle-timeout watchdog firing after 3 s of silence.
    last_activity = time.monotonic()
    idle_timeout_s = 3.0
    killed_reason: str | None = None
    while proc.returncode is None:
        now = time.monotonic()
        if (now - last_activity) > idle_timeout_s:
            killed_reason = f"idle timeout ({idle_timeout_s}s)"
            break
        try:
            await asyncio.wait_for(asyncio.shield(proc.wait()), timeout=1.0)
        except asyncio.TimeoutError:
            continue

    print(f"[smoke] watchdog fired: reason={killed_reason}")
    assert killed_reason is not None, "watchdog did not fire"

    kill_process_tree(child_pid, reason=f"smoke {killed_reason}")
    try:
        await asyncio.wait_for(proc.wait(), timeout=10)
    except asyncio.TimeoutError:
        print("[smoke] proc.wait() timed out after kill; continuing")

    # Give the OS a moment to reap.
    for _ in range(10):
        if not is_process_running(child_pid) and not is_process_running(grandchild_pid):
            break
        await asyncio.sleep(0.3)

    parent_alive = is_process_running(child_pid)
    grand_alive = is_process_running(grandchild_pid)
    print(f"[smoke] AFTER: parent alive={parent_alive} grandchild alive={grand_alive}")

    if parent_alive or grand_alive:
        print("[smoke] FAIL: stragglers remain — process tree kill did not propagate")
        return 1
    print("[smoke] PASS: full process tree torn down")
    return 0


if __name__ == "__main__":
    rc = asyncio.run(main())
    sys.exit(rc)
