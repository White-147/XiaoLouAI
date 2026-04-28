from . import Migration
import sqlite3


class V2AddCanvases(Migration):
    version = 2
    description = "Add canvases"

    def up(self, conn: sqlite3.Connection) -> None:
        # Create canvases table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS canvases (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                data TEXT,
                description TEXT DEFAULT '',
                thumbnail TEXT DEFAULT '',
                created_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_canvases_updated_at ON canvases(updated_at DESC, id DESC)
        """)

        # Check if canvas_id column already exists in chat_sessions
        cursor = conn.execute("PRAGMA table_info(chat_sessions)")
        columns = [column[1] for column in cursor.fetchall()]

        if 'canvas_id' not in columns:
            # Add canvas_id column to chat_sessions only if it doesn't exist
            conn.execute(
                "ALTER TABLE chat_sessions ADD COLUMN canvas_id TEXT REFERENCES canvases(id)")

        # Create default canvas
        conn.execute("""
            INSERT OR IGNORE INTO canvases (id, name)
            VALUES ('default', 'Default Canvas')
        """)

        # Associate all existing sessions with default canvas
        conn.execute("""
            UPDATE chat_sessions
            SET canvas_id = 'default'
            WHERE canvas_id IS NULL
        """)

    def down(self, conn: sqlite3.Connection) -> None:
        # Remove canvas_id column from chat_sessions
        conn.execute("""
            CREATE TABLE chat_sessions_new (
                id TEXT PRIMARY KEY,
                created_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
                title TEXT,
                model TEXT,
                provider TEXT
            )
        """)

        conn.execute("""
            INSERT INTO chat_sessions_new (id, created_at, updated_at, title, model, provider)
            SELECT id, created_at, updated_at, title, model, provider FROM chat_sessions
        """)

        conn.execute("DROP TABLE chat_sessions")
        conn.execute("ALTER TABLE chat_sessions_new RENAME TO chat_sessions")

        conn.execute("DROP TABLE IF EXISTS canvases")
