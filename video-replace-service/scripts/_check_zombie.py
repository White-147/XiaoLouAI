"""Look up the most recent ``zombie_pl_*`` job in PostgreSQL."""
import asyncio
import json
import os
import sys

import asyncpg


DATABASE_URL = os.environ.get("VR_DATABASE_URL") or os.environ.get("DATABASE_URL") or "postgres://root:root@127.0.0.1:5432/xiaolou"


async def main() -> int:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        row = await conn.fetchrow(
            """
            SELECT job_id, stage, COALESCE(message,'') AS message,
                   COALESCE(error,'') AS error, data
            FROM video_replace_jobs
            WHERE job_id LIKE 'zombie_pl_%'
            ORDER BY updated_at DESC
            LIMIT 1
            """
        )
    finally:
        await conn.close()
    if not row:
        print("no zombie job found")
        return 1

    data = row["data"]
    if isinstance(data, str):
        data = json.loads(data or "{}")
    data = data if isinstance(data, dict) else {}
    print("job_id:", row["job_id"])
    print("stage:", row["stage"])
    print("msg:  ", row["message"][:120])
    print("err:  ", row["error"][:160])
    print("pipeline_pid:", data.get("pipeline_pid"))
    print("subprocess_pid:", data.get("subprocess_pid"))
    return 0


sys.exit(asyncio.run(main()))
