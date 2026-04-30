"""Inspect a set of jobs after a core-api startup reconcile and print
their stage / message / error so a human can sanity-check the reap.

Portable: DB path defaults to ``<repo>/video-replace-service/data/tasks.sqlite``
resolved from this file's location. Override with ``VR_TASKS_DB``.
"""
import json
import os
import sqlite3
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SERVICE_DIR = SCRIPT_DIR.parent
DB = Path(os.environ.get("VR_TASKS_DB") or (SERVICE_DIR / "data" / "tasks.sqlite"))

targets = [
    "vr_44da56ce7e",
    "vr_64f9a7c5ad",
    "vr_c59cc7cc86",
    "zombie_test_adddf570",
]

con = sqlite3.connect(str(DB))
qmarks = ",".join("?" * len(targets))
cur = con.execute(
    f"SELECT job_id, stage, COALESCE(error,''), COALESCE(message,''), data "
    f"FROM jobs WHERE job_id IN ({qmarks})",
    targets,
)
rows = cur.fetchall()
for r in rows:
    job_id, stage, error, message, data = r
    d = json.loads(data or "{}")
    pid = d.get("subprocess_pid")
    print(f"job={job_id} stage={stage} subprocess_pid={pid}")
    print(f"  error: {error[:140]}")
    print(f"  msg:   {message[:140]}")
con.close()
