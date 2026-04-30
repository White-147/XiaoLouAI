import sqlite3, json

conn = sqlite3.connect('./data/tasks.sqlite')
conn.row_factory = sqlite3.Row
rows = conn.execute(
    'SELECT job_id, stage, progress, message, data FROM jobs ORDER BY rowid DESC LIMIT 8'
).fetchall()
for r in rows:
    d = json.loads(r['data'] or '{}')
    sub = d.get('subprocess_pid', '-')
    pip = d.get('pipeline_pid', '-')
    adv = d.get('advanced', {})
    print(f"{r['job_id']}  {r['stage']}  {r['progress']*100:.0f}%  sub={sub} pip={pip}  steps={adv.get('sample_steps','-')}")
    print(f"  msg: {r['message']}")
