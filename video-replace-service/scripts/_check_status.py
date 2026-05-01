import asyncio
import json
import os

import asyncpg


DATABASE_URL = os.environ.get("VR_DATABASE_URL") or os.environ.get("DATABASE_URL") or "postgres://root:root@127.0.0.1:5432/xiaolou"


async def main() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch(
            """
            SELECT job_id, stage, progress, message, data
            FROM video_replace_jobs
            ORDER BY updated_at DESC
            LIMIT 8
            """
        )
    finally:
        await conn.close()

    for row in rows:
        data = row["data"]
        if isinstance(data, str):
            data = json.loads(data or "{}")
        sub = data.get("subprocess_pid", "-") if isinstance(data, dict) else "-"
        pip = data.get("pipeline_pid", "-") if isinstance(data, dict) else "-"
        adv = data.get("advanced", {}) if isinstance(data, dict) else {}
        print(f"{row['job_id']}  {row['stage']}  {float(row['progress'] or 0) * 100:.0f}%  sub={sub} pip={pip}  steps={adv.get('sample_steps','-')}")
        print(f"  msg: {row['message']}")


asyncio.run(main())
