"""Insert a fake non-terminal job with bogus pipeline_pid / subprocess_pid
so core-api's reconcileOnStartup has something to reap on the next boot.

Portable: DB path defaults to ``<repo>/video-replace-service/data/tasks.sqlite``
resolved from this file's location. Override with ``VR_TASKS_DB``.
"""
import json
import os
import sqlite3
import time
import uuid
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SERVICE_DIR = SCRIPT_DIR.parent
DB = Path(os.environ.get("VR_TASKS_DB") or (SERVICE_DIR / "data" / "tasks.sqlite"))

jid = "zombie_pl_" + uuid.uuid4().hex[:8]
now = time.strftime("%Y-%m-%dT%H:%M:%S")
data = {
    "pipeline_pid": 999_998,
    "subprocess_pid": 999_999,
    "source_of_truth": "injected by _inject_zombie_pipeline.py for reconcile test",
}

con = sqlite3.connect(str(DB))
con.execute(
    "INSERT INTO jobs(job_id, stage, progress, data, created_at, updated_at) "
    "VALUES (?,?,?,?,?,?)",
    (jid, "replacing", 0.7, json.dumps(data), now, now),
)
con.commit()
con.close()

print("injected zombie job:", jid)
