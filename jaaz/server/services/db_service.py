import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import asyncpg

MAX_INLINE_THUMBNAIL_CHARS = 120_000
DEFAULT_DATABASE_URL = "postgres://root:root@127.0.0.1:5432/xiaolou"


CREATE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS jaaz_canvases (
  id text PRIMARY KEY,
  name text NOT NULL,
  data text,
  description text NOT NULL DEFAULT '',
  thumbnail text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS jaaz_chat_sessions (
  id text PRIMARY KEY,
  canvas_id text,
  title text,
  model text,
  provider text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS jaaz_chat_messages (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL,
  role text NOT NULL,
  message text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS jaaz_comfy_workflows (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  api_json text,
  description text NOT NULL DEFAULT '',
  inputs text,
  outputs text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jaaz_chat_sessions_canvas ON jaaz_chat_sessions(canvas_id);
CREATE INDEX IF NOT EXISTS idx_jaaz_chat_messages_session_id ON jaaz_chat_messages(session_id, id);
CREATE INDEX IF NOT EXISTS idx_jaaz_canvases_updated ON jaaz_canvases(updated_at);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _database_url() -> str:
    value = (
        os.getenv("JAAZ_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or DEFAULT_DATABASE_URL
    ).strip()
    if value.startswith("postgresql+asyncpg://"):
        return "postgresql://" + value.removeprefix("postgresql+asyncpg://")
    if value.startswith(("postgres://", "postgresql://")):
        return value
    raise ValueError("JAAZ_DATABASE_URL must be a PostgreSQL URL")


def _sanitize_canvas_thumbnail(thumbnail: Optional[str]) -> Optional[str]:
    if not thumbnail:
        return thumbnail
    if thumbnail.startswith("data:") and len(thumbnail) > MAX_INLINE_THUMBNAIL_CHARS:
        return None
    return thumbnail


def _parse_json_object(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


class DatabaseService:
    def __init__(self):
        self.database_url = _database_url()
        self._pool: asyncpg.Pool | None = None
        self._schema_ready = False
        self._init_lock = asyncio.Lock()

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            self._pool = await asyncpg.create_pool(
                dsn=self.database_url,
                min_size=1,
                max_size=int(os.getenv("JAAZ_PGPOOL_MAX", "5")),
            )
        return self._pool

    async def _ensure_ready(self) -> None:
        if self._schema_ready:
            return
        async with self._init_lock:
            if self._schema_ready:
                return
            pool = await self._get_pool()
            async with pool.acquire() as conn:
                await conn.execute(CREATE_SCHEMA_SQL)
            self._schema_ready = True

    async def create_canvas(self, id: str, name: str):
        """Create a new canvas"""
        await self._ensure_ready()
        now = _now()
        async with (await self._get_pool()).acquire() as conn:
            await conn.execute(
                """
                INSERT INTO jaaz_canvases (id, name, created_at, updated_at)
                VALUES ($1, $2, $3, $4)
                """,
                id,
                name,
                now,
                now,
            )

    async def list_canvases(self) -> List[Dict[str, Any]]:
        """Get all canvases"""
        await self._ensure_ready()
        async with (await self._get_pool()).acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, name, description, thumbnail, created_at, updated_at
                FROM jaaz_canvases
                ORDER BY updated_at DESC
                """
            )
        canvases = []
        for row in rows:
            canvas = dict(row)
            canvas["thumbnail"] = _sanitize_canvas_thumbnail(canvas.get("thumbnail"))
            canvases.append(canvas)
        return canvases

    async def create_chat_session(self, id: str, model: str, provider: str, canvas_id: str, title: Optional[str] = None):
        """Save a new chat session"""
        await self._ensure_ready()
        now = _now()
        async with (await self._get_pool()).acquire() as conn:
            await conn.execute(
                """
                INSERT INTO jaaz_chat_sessions (id, model, provider, canvas_id, title, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (id) DO UPDATE SET
                  model = EXCLUDED.model,
                  provider = EXCLUDED.provider,
                  canvas_id = EXCLUDED.canvas_id,
                  title = COALESCE(EXCLUDED.title, jaaz_chat_sessions.title),
                  updated_at = EXCLUDED.updated_at
                """,
                id,
                model,
                provider,
                canvas_id,
                title,
                now,
                now,
            )

    async def create_message(self, session_id: str, role: str, message: str):
        """Save a chat message"""
        await self._ensure_ready()
        now = _now()
        async with (await self._get_pool()).acquire() as conn:
            await conn.execute(
                """
                INSERT INTO jaaz_chat_messages (session_id, role, message, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5)
                """,
                session_id,
                role,
                message,
                now,
                now,
            )

    async def get_chat_history(self, session_id: str, limit: Optional[int] = None, before_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get chat history for a session"""
        await self._ensure_ready()
        async with (await self._get_pool()).acquire() as conn:
            if limit and limit > 0:
                bounded_limit = min(max(int(limit), 1), 200)
                if before_id:
                    rows = await conn.fetch(
                        """
                        SELECT role, message, id
                        FROM jaaz_chat_messages
                        WHERE session_id = $1 AND id < $2
                        ORDER BY id DESC
                        LIMIT $3
                        """,
                        session_id,
                        int(before_id),
                        bounded_limit,
                    )
                else:
                    rows = await conn.fetch(
                        """
                        SELECT role, message, id
                        FROM jaaz_chat_messages
                        WHERE session_id = $1
                        ORDER BY id DESC
                        LIMIT $2
                        """,
                        session_id,
                        bounded_limit,
                    )
                rows = list(reversed(rows))
            else:
                rows = await conn.fetch(
                    """
                    SELECT role, message, id
                    FROM jaaz_chat_messages
                    WHERE session_id = $1
                    ORDER BY id ASC
                    """,
                    session_id,
                )

        messages = []
        for row in rows:
            if row["message"]:
                try:
                    messages.append(json.loads(row["message"]))
                except json.JSONDecodeError:
                    pass
        return messages

    async def get_chat_history_page(self, session_id: str, limit: int = 80, before_id: Optional[int] = None) -> Dict[str, Any]:
        """Get one page of chat history, newest page first but returned in ascending order."""
        await self._ensure_ready()
        bounded_limit = min(max(int(limit or 80), 1), 200)
        query_limit = bounded_limit + 1
        async with (await self._get_pool()).acquire() as conn:
            if before_id:
                rows_desc = await conn.fetch(
                    """
                    SELECT role, message, id
                    FROM jaaz_chat_messages
                    WHERE session_id = $1 AND id < $2
                    ORDER BY id DESC
                    LIMIT $3
                    """,
                    session_id,
                    int(before_id),
                    query_limit,
                )
            else:
                rows_desc = await conn.fetch(
                    """
                    SELECT role, message, id
                    FROM jaaz_chat_messages
                    WHERE session_id = $1
                    ORDER BY id DESC
                    LIMIT $2
                    """,
                    session_id,
                    query_limit,
                )

        has_more = len(rows_desc) > bounded_limit
        kept_rows = list(reversed(rows_desc[:bounded_limit]))
        messages = []
        for row in kept_rows:
            if row["message"]:
                try:
                    messages.append(json.loads(row["message"]))
                except json.JSONDecodeError:
                    pass

        next_before_id = kept_rows[0]["id"] if has_more and kept_rows else None
        return {
            "messages": messages,
            "has_more": has_more,
            "next_before_id": next_before_id,
        }

    async def list_sessions(self, canvas_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """List chat sessions"""
        await self._ensure_ready()
        async with (await self._get_pool()).acquire() as conn:
            if canvas_id:
                rows = await conn.fetch(
                    """
                    SELECT id, title, model, provider, created_at, updated_at
                    FROM jaaz_chat_sessions
                    WHERE canvas_id = $1
                    ORDER BY updated_at DESC
                    """,
                    canvas_id,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT id, title, model, provider, created_at, updated_at
                    FROM jaaz_chat_sessions
                    ORDER BY updated_at DESC
                    """
                )
        return [dict(row) for row in rows]

    async def save_canvas_data(self, id: str, data: str, thumbnail: str = None):
        """Save canvas data"""
        await self._ensure_ready()
        async with (await self._get_pool()).acquire() as conn:
            await conn.execute(
                """
                UPDATE jaaz_canvases
                SET data = $1, thumbnail = $2, updated_at = $3
                WHERE id = $4
                """,
                data,
                thumbnail,
                _now(),
                id,
            )

    async def get_canvas_data(self, id: str) -> Optional[Dict[str, Any]]:
        """Get canvas data"""
        await self._ensure_ready()
        async with (await self._get_pool()).acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT data, name
                FROM jaaz_canvases
                WHERE id = $1
                """,
                id,
            )

        sessions = await self.list_sessions(id)
        if row:
            return {
                "data": _parse_json_object(row["data"]),
                "name": row["name"],
                "sessions": sessions,
            }
        return None

    async def delete_canvas(self, id: str):
        """Delete canvas and related data"""
        await self._ensure_ready()
        async with (await self._get_pool()).acquire() as conn:
            await conn.execute("DELETE FROM jaaz_canvases WHERE id = $1", id)

    async def rename_canvas(self, id: str, name: str):
        """Rename canvas"""
        await self._ensure_ready()
        async with (await self._get_pool()).acquire() as conn:
            await conn.execute(
                "UPDATE jaaz_canvases SET name = $1, updated_at = $2 WHERE id = $3",
                name,
                _now(),
                id,
            )

    async def create_comfy_workflow(self, name: str, api_json: str, description: str, inputs: str, outputs: str = None):
        """Create a new comfy workflow"""
        await self._ensure_ready()
        now = _now()
        async with (await self._get_pool()).acquire() as conn:
            await conn.execute(
                """
                INSERT INTO jaaz_comfy_workflows (name, api_json, description, inputs, outputs, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                name,
                api_json,
                description,
                inputs,
                outputs,
                now,
                now,
            )

    async def list_comfy_workflows(self) -> List[Dict[str, Any]]:
        """List all comfy workflows"""
        await self._ensure_ready()
        async with (await self._get_pool()).acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, name, description, api_json, inputs, outputs
                FROM jaaz_comfy_workflows
                ORDER BY id DESC
                """
            )
        return [dict(row) for row in rows]

    async def delete_comfy_workflow(self, id: int):
        """Delete a comfy workflow"""
        await self._ensure_ready()
        async with (await self._get_pool()).acquire() as conn:
            result = await conn.execute("DELETE FROM jaaz_comfy_workflows WHERE id = $1", id)
        return {"success": True, "result": result}

    async def get_comfy_workflow(self, id: int):
        """Get comfy workflow dict"""
        await self._ensure_ready()
        async with (await self._get_pool()).acquire() as conn:
            row = await conn.fetchrow(
                "SELECT api_json FROM jaaz_comfy_workflows WHERE id = $1",
                id,
            )
        if not row:
            return None
        try:
            return json.loads(row["api_json"]) if isinstance(row["api_json"], str) else row["api_json"]
        except json.JSONDecodeError as exc:
            raise ValueError(f"Stored workflow api_json is not valid JSON: {exc}")


db_service = DatabaseService()
