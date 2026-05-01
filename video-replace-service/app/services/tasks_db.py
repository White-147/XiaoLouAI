"""
Async PostgreSQL task store for video replacement jobs.

The core-api process and Python CLI subprocesses share the
``video_replace_jobs`` table. SQLite task files are now migration inputs only.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import asyncpg

from ..schemas import JobStage


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_url(database_url: str) -> str:
    value = str(database_url or "").strip()
    if value.startswith("postgresql+asyncpg://"):
        return "postgresql://" + value.removeprefix("postgresql+asyncpg://")
    if value.startswith(("postgres://", "postgresql://")):
        return value
    raise ValueError("VR_DATABASE_URL must be a PostgreSQL URL, for example postgres://root:root@127.0.0.1:5432/xiaolou")


def _parse_data(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value or "{}")
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


class TasksDB:
    def __init__(self, database_url: str) -> None:
        self.database_url = _normalize_url(database_url)
        self._pool: asyncpg.Pool | None = None

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            self._pool = await asyncpg.create_pool(
                dsn=self.database_url,
                min_size=1,
                max_size=5,
            )
        return self._pool

    async def init(self) -> None:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS video_replace_jobs (
                    job_id text PRIMARY KEY,
                    stage text NOT NULL,
                    progress numeric NOT NULL DEFAULT 0,
                    message text,
                    error text,
                    data jsonb NOT NULL DEFAULT '{}'::jsonb,
                    created_at text NOT NULL,
                    updated_at text NOT NULL
                )
                """
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_video_replace_jobs_stage ON video_replace_jobs(stage)"
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_video_replace_jobs_updated ON video_replace_jobs(updated_at)"
            )

    async def _notify(self, conn: asyncpg.Connection, job_id: str) -> None:
        await conn.execute("SELECT pg_notify('video_replace_job_changed', $1)", job_id)

    async def create(
        self,
        job_id: str,
        data: dict[str, Any] | None = None,
        stage: JobStage = JobStage.UPLOADED,
    ) -> None:
        now = _now()
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO video_replace_jobs (job_id, stage, progress, data, created_at, updated_at)
                VALUES ($1, $2, $3, $4::jsonb, $5, $6)
                ON CONFLICT (job_id) DO UPDATE SET
                    stage = EXCLUDED.stage,
                    progress = EXCLUDED.progress,
                    data = EXCLUDED.data,
                    updated_at = EXCLUDED.updated_at
                """,
                job_id,
                stage.value,
                0.0,
                json.dumps(data or {}),
                now,
                now,
            )
            await self._notify(conn, job_id)

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
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT stage, progress, data FROM video_replace_jobs WHERE job_id = $1",
                job_id,
            )
            if not row:
                raise LookupError(f"job {job_id} not found")

            cur_data = _parse_data(row["data"])
            if data_patch:
                cur_data.update(data_patch)

            await conn.execute(
                """
                UPDATE video_replace_jobs SET
                    stage = $1,
                    progress = $2,
                    message = COALESCE($3, message),
                    error = COALESCE($4, error),
                    data = $5::jsonb,
                    updated_at = $6
                WHERE job_id = $7
                """,
                stage.value if stage else row["stage"],
                progress if progress is not None else float(row["progress"] or 0),
                message,
                error,
                json.dumps(cur_data),
                _now(),
                job_id,
            )
            await self._notify(conn, job_id)

    async def get(self, job_id: str) -> dict[str, Any] | None:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM video_replace_jobs WHERE job_id = $1",
                job_id,
            )
        if not row:
            return None
        d = dict(row)
        d["progress"] = float(d.get("progress") or 0)
        d["data"] = _parse_data(d.get("data"))
        return d

    async def list_in_stages(self, stages: list[str]) -> list[dict[str, Any]]:
        """Return all jobs whose stage is any of ``stages``."""
        if not stages:
            return []
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM video_replace_jobs
                WHERE stage = ANY($1::text[])
                ORDER BY updated_at ASC
                """,
                stages,
            )
        out: list[dict[str, Any]] = []
        for row in rows:
            d = dict(row)
            d["progress"] = float(d.get("progress") or 0)
            d["data"] = _parse_data(d.get("data"))
            out.append(d)
        return out
