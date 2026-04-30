import sqlite3
import json
import os
from typing import List, Dict, Any, Optional
import aiosqlite
from .config_service import USER_DATA_DIR
from .migrations.manager import MigrationManager, CURRENT_VERSION

DB_PATH = os.path.join(USER_DATA_DIR, "localmanus.db")
MAX_INLINE_THUMBNAIL_CHARS = 120_000


def _sanitize_canvas_thumbnail(thumbnail: Optional[str]) -> Optional[str]:
    if not thumbnail:
        return thumbnail
    if thumbnail.startswith("data:") and len(thumbnail) > MAX_INLINE_THUMBNAIL_CHARS:
        return None
    return thumbnail

class DatabaseService:
    def __init__(self):
        self.db_path = DB_PATH
        self._ensure_db_directory()
        self._migration_manager = MigrationManager()
        self._init_db()

    def _ensure_db_directory(self):
        """Ensure the database directory exists"""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

    def _init_db(self):
        """Initialize the database with the current schema"""
        with sqlite3.connect(self.db_path) as conn:
            # Create version table if it doesn't exist
            conn.execute("""
                CREATE TABLE IF NOT EXISTS db_version (
                    version INTEGER PRIMARY KEY
                )
            """)
            
            # Get current version
            cursor = conn.execute("SELECT version FROM db_version")
            current_version = cursor.fetchone()
            print('local db version', current_version, 'latest version', CURRENT_VERSION)
            
            if current_version is None:
                # First time setup - start from version 0
                conn.execute("INSERT INTO db_version (version) VALUES (0)")
                self._migration_manager.migrate(conn, 0, CURRENT_VERSION)
            elif current_version[0] < CURRENT_VERSION:
                print('Migrating database from version', current_version[0], 'to', CURRENT_VERSION)
                # Need to migrate
                self._migration_manager.migrate(conn, current_version[0], CURRENT_VERSION)

    async def create_canvas(self, id: str, name: str):
        """Create a new canvas"""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                INSERT INTO canvases (id, name)
                VALUES (?, ?)
            """, (id, name))
            await db.commit()

    async def list_canvases(self) -> List[Dict[str, Any]]:
        """Get all canvases"""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            cursor = await db.execute("""
                SELECT id, name, description, thumbnail, created_at, updated_at
                FROM canvases
                ORDER BY updated_at DESC
            """)
            rows = await cursor.fetchall()
            canvases = []
            for row in rows:
                canvas = dict(row)
                canvas["thumbnail"] = _sanitize_canvas_thumbnail(canvas.get("thumbnail"))
                canvases.append(canvas)
            return canvases

    async def create_chat_session(self, id: str, model: str, provider: str, canvas_id: str, title: Optional[str] = None):
        """Save a new chat session"""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                INSERT INTO chat_sessions (id, model, provider, canvas_id, title)
                VALUES (?, ?, ?, ?, ?)
            """, (id, model, provider, canvas_id, title))
            await db.commit()

    async def create_message(self, session_id: str, role: str, message: str):
        """Save a chat message"""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                INSERT INTO chat_messages (session_id, role, message)
                VALUES (?, ?, ?)
            """, (session_id, role, message))
            await db.commit()

    async def get_chat_history(self, session_id: str, limit: Optional[int] = None, before_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get chat history for a session"""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            if limit and limit > 0:
                bounded_limit = min(max(int(limit), 1), 200)
                params: tuple[Any, ...]
                if before_id:
                    params = (session_id, int(before_id), bounded_limit)
                    cursor = await db.execute("""
                        SELECT role, message, id
                        FROM chat_messages
                        WHERE session_id = ? AND id < ?
                        ORDER BY id DESC
                        LIMIT ?
                    """, params)
                else:
                    params = (session_id, bounded_limit)
                    cursor = await db.execute("""
                        SELECT role, message, id
                        FROM chat_messages
                        WHERE session_id = ?
                        ORDER BY id DESC
                        LIMIT ?
                    """, params)
            else:
                cursor = await db.execute("""
                    SELECT role, message, id
                    FROM chat_messages
                    WHERE session_id = ?
                    ORDER BY id ASC
                """, (session_id,))
            rows = await cursor.fetchall()
            if limit and limit > 0:
                rows = list(reversed(rows))
            
            messages = []
            for row in rows:
                row_dict = dict(row)
                if row_dict['message']:
                    try:
                        msg = json.loads(row_dict['message'])
                        messages.append(msg)
                    except:
                        pass
                
            return messages

    async def get_chat_history_page(self, session_id: str, limit: int = 80, before_id: Optional[int] = None) -> Dict[str, Any]:
        """Get one page of chat history, newest page first but returned in ascending order."""
        bounded_limit = min(max(int(limit or 80), 1), 200)
        query_limit = bounded_limit + 1
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            if before_id:
                cursor = await db.execute("""
                    SELECT role, message, id
                    FROM chat_messages
                    WHERE session_id = ? AND id < ?
                    ORDER BY id DESC
                    LIMIT ?
                """, (session_id, int(before_id), query_limit))
            else:
                cursor = await db.execute("""
                    SELECT role, message, id
                    FROM chat_messages
                    WHERE session_id = ?
                    ORDER BY id DESC
                    LIMIT ?
                """, (session_id, query_limit))

            rows_desc = await cursor.fetchall()
            has_more = len(rows_desc) > bounded_limit
            kept_rows = list(reversed(rows_desc[:bounded_limit]))

            messages = []
            for row in kept_rows:
                row_dict = dict(row)
                if row_dict['message']:
                    try:
                        messages.append(json.loads(row_dict['message']))
                    except:
                        pass

            next_before_id = kept_rows[0]['id'] if has_more and kept_rows else None
            return {
                'messages': messages,
                'has_more': has_more,
                'next_before_id': next_before_id,
            }

    async def list_sessions(self, canvas_id: str) -> List[Dict[str, Any]]:
        """List all chat sessions"""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            if canvas_id:
                cursor = await db.execute("""
                    SELECT id, title, model, provider, created_at, updated_at
                    FROM chat_sessions
                    WHERE canvas_id = ?
                    ORDER BY updated_at DESC
                """, (canvas_id,))
            else:
                cursor = await db.execute("""
                    SELECT id, title, model, provider, created_at, updated_at
                    FROM chat_sessions
                    ORDER BY updated_at DESC
                """)
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

    async def save_canvas_data(self, id: str, data: str, thumbnail: str = None):
        """Save canvas data"""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                UPDATE canvases 
                SET data = ?, thumbnail = ?, updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ?
            """, (data, thumbnail, id))
            await db.commit()

    async def get_canvas_data(self, id: str) -> Optional[Dict[str, Any]]:
        """Get canvas data"""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            cursor = await db.execute("""
                SELECT data, name
                FROM canvases
                WHERE id = ?
            """, (id,))
            row = await cursor.fetchone()

            sessions = await self.list_sessions(id)
            
            if row:
                return {
                    'data': json.loads(row['data']) if row['data'] else {},
                    'name': row['name'],
                    'sessions': sessions
                }
            return None

    async def delete_canvas(self, id: str):
        """Delete canvas and related data"""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM canvases WHERE id = ?", (id,))
            await db.commit()

    async def rename_canvas(self, id: str, name: str):
        """Rename canvas"""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("UPDATE canvases SET name = ? WHERE id = ?", (name, id))
            await db.commit()

    async def create_comfy_workflow(self, name: str, api_json: str, description: str, inputs: str, outputs: str = None):
        """Create a new comfy workflow"""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                INSERT INTO comfy_workflows (name, api_json, description, inputs, outputs)
                VALUES (?, ?, ?, ?, ?)
            """, (name, api_json, description, inputs, outputs))
            await db.commit()

    async def list_comfy_workflows(self) -> List[Dict[str, Any]]:
        """List all comfy workflows"""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            cursor = await db.execute("SELECT id, name, description, api_json, inputs, outputs FROM comfy_workflows ORDER BY id DESC")
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

    async def delete_comfy_workflow(self, id: int):
        """Delete a comfy workflow"""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM comfy_workflows WHERE id = ?", (id,))
            await db.commit()

    async def get_comfy_workflow(self, id: int):
        """Get comfy workflow dict"""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            cursor = await db.execute(
                "SELECT api_json FROM comfy_workflows WHERE id = ?", (id,)
            )
            row = await cursor.fetchone()
        try:
            workflow_json = (
                row["api_json"]
                if isinstance(row["api_json"], dict)
                else json.loads(row["api_json"])
            )
            return workflow_json
        except json.JSONDecodeError as exc:
            raise ValueError(f"Stored workflow api_json is not valid JSON: {exc}")

# Create a singleton instance
db_service = DatabaseService()
