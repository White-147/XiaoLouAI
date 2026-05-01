"""Insert a fake non-terminal PostgreSQL job for startup reconcile testing."""
import asyncio
import json
import os
from datetime import datetime, timezone
import uuid

import asyncpg


DATABASE_URL = os.environ.get("VR_DATABASE_URL") or os.environ.get("DATABASE_URL") or "postgres://root:root@127.0.0.1:5432/xiaolou"


async def main() -> None:
    jid = "zombie_pl_" + uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).isoformat()
    data = {
        "pipeline_pid": 999_998,
        "subprocess_pid": 999_999,
        "source_of_truth": "injected by _inject_zombie_pipeline.py for reconcile test",
    }
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(
            """
            INSERT INTO video_replace_jobs(job_id, stage, progress, data, created_at, updated_at)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6)
            """,
            jid,
            "replacing",
            0.7,
            json.dumps(data),
            now,
            now,
        )
    finally:
        await conn.close()
    print("injected zombie job:", jid)


asyncio.run(main())
