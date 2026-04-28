"""Look up the most recent ``zombie_pl_*`` job in tasks.sqlite and print
its stage / message / error + PID fields. Used after a core-api restart
to confirm reconcileOnStartup flipped it to ``failed`` and cleared the
pipeline_pid / subprocess_pid columns.

Portable: DB path defaults to ``<repo>/video-replace-service/data/tasks.sqlite``
resolved from this file's location. Override with ``VR_TASKS_DB``.
"""
import json
import os
import sqlite3
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SERVICE_DIR = SCRIPT_DIR.parent
DB = Path(os.environ.get("VR_TASKS_DB") or (SERVICE_DIR / "data" / "tasks.sqlite"))

con = sqlite3.connect(str(DB))
row = con.execute(
    "SELECT job_id, stage, COALESCE(message,''), COALESCE(error,''), data FROM jobs "
    "WHERE job_id LIKE 'zombie_pl_%' ORDER BY updated_at DESC LIMIT 1"
).fetchone()
con.close()
if not row:
    print("no zombie job found")
    sys.exit(1)
job_id, stage, msg, err, data = row
d = json.loads(data or "{}")
print("job_id:", job_id)
print("stage:", stage)
print("msg:  ", msg[:120])
print("err:  ", err[:160])
print("pipeline_pid:", d.get("pipeline_pid"))
print("subprocess_pid:", d.get("subprocess_pid"))
