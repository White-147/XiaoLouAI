"""
Minimal async SQLite task store.

Single table `jobs` holds the full lifecycle of a replacement job:
   uploaded → detecting → detected → queued → tracking → mask_ready
            → replacing → succeeded / failed.

Using raw aiosqlite keeps the dependency footprint small. The `data`
column stores the mutable payload (urls, candidates, selections) as JSON.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import aiosqlite

from ..schemas import JobStage


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TasksDB:
    def __init__(self, database_url: str) -> None:
        if database_url.startswith("sqlite+aiosqlite:///"):
            self.path = database_url.replace("sqlite+aiosqlite:///", "", 1)
        elif database_url.startswith("sqlite:///"):
            self.path = database_url.replace("sqlite:///", "", 1)
        else:
            self.path = database_url

    async def init(self) -> None:
        async with aiosqlite.connect(self.path) as db:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    stage TEXT NOT NULL,
                    progress REAL NOT NULL DEFAULT 0.0,
                    message TEXT,
                    error TEXT,
                    data TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            await db.commit()

    # ──────────────────────────────────────────────────────────────
    async def create(
        self,
        job_id: str,
        data: dict[str, Any] | None = None,
        stage: JobStage = JobStage.UPLOADED,
    ) -> None:
        now = _now()
        async with aiosqlite.connect(self.path) as db:
            await db.execute(
                "INSERT INTO jobs (job_id, stage, progress, data, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                (job_id, stage.value, 0.0, json.dumps(data or {}), now, now),
            )
            await db.commit()

    async def update(
        self,
        job_id: str,
        *,
        stage: JobStage | None = None,
        progress: float | None = None,
        message: str | None = None,
        error: str | None = None,
        data_patch: dict[str, Any] | None = None,
    ) -> None:
        async with aiosqlite.connect(self.path) as db:
            cur = await db.execute(
                "SELECT stage, progress, data FROM jobs WHERE job_id = ?",
                (job_id,),
            )
            row = await cur.fetchone()
            if not row:
                raise LookupError(f"job {job_id} not found")

            cur_stage, cur_progress, cur_data_raw = row
            cur_data = json.loads(cur_data_raw or "{}")
            if data_patch:
                cur_data.update(data_patch)

            await db.execute(
                """
                UPDATE jobs SET
                    stage = ?,
                    progress = ?,
                    message = COALESCE(?, message),
                    error = COALESCE(?, error),
                    data = ?,
                    updated_at = ?
                WHERE job_id = ?
                """,
                (
                    stage.value if stage else cur_stage,
                    progress if progress is not None else cur_progress,
                    message,
                    error,
                    json.dumps(cur_data),
                    _now(),
                    job_id,
                ),
            )
            await db.commit()

    async def get(self, job_id: str) -> dict[str, Any] | None:
        async with aiosqlite.connect(self.path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,))
            row = await cur.fetchone()
            if not row:
                return None
            d = dict(row)
            d["data"] = json.loads(d.get("data") or "{}")
            return d

    async def list_in_stages(self, stages: list[str]) -> list[dict[str, Any]]:
        """Return all jobs whose stage is any of ``stages``.

        Used on startup to reap in-flight jobs that were abandoned by a
        previous crash/kill — they're impossible to resume because any
        in-memory queue + GPU process died with the service.
        """
        if not stages:
            return []
        placeholders = ",".join("?" * len(stages))
        async with aiosqlite.connect(self.path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                f"SELECT * FROM jobs WHERE stage IN ({placeholders}) ORDER BY updated_at ASC",
                tuple(stages),
            )
            rows = await cur.fetchall()
            out: list[dict[str, Any]] = []
            for row in rows:
                d = dict(row)
                d["data"] = json.loads(d.get("data") or "{}")
                out.append(d)
            return out
