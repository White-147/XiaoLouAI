"""Inspect selected PostgreSQL video-replace jobs after startup reconcile."""
import asyncio
import json
import os

import asyncpg


DATABASE_URL = os.environ.get("VR_DATABASE_URL") or os.environ.get("DATABASE_URL") or "postgres://root:root@127.0.0.1:5432/xiaolou"

TARGETS = [
    "vr_44da56ce7e",
    "vr_64f9a7c5ad",
    "vr_c59cc7cc86",
    "zombie_test_adddf570",
]


async def main() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch(
            """
            SELECT job_id, stage, COALESCE(error,'') AS error,
                   COALESCE(message,'') AS message, data
            FROM video_replace_jobs
            WHERE job_id = ANY($1::text[])
            """,
            TARGETS,
        )
    finally:
        await conn.close()

    for row in rows:
        data = row["data"]
        if isinstance(data, str):
            data = json.loads(data or "{}")
        data = data if isinstance(data, dict) else {}
        print(f"job={row['job_id']} stage={row['stage']} subprocess_pid={data.get('subprocess_pid')}")
        print(f"  error: {row['error'][:140]}")
        print(f"  msg:   {row['message'][:140]}")


asyncio.run(main())
