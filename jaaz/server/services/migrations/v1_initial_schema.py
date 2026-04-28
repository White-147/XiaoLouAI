from . import Migration
import sqlite3

class V1InitialSchema(Migration):
    version = 1
    description = "Initial schema"

    def up(self, conn: sqlite3.Connection) -> None:
        # Create chat_sessions table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                canvas_id TEXT,
                created_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
                title TEXT,
                model TEXT,
                provider TEXT,
                FOREIGN KEY (canvas_id) REFERENCES canvases(id)
            )
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC, id DESC)
        """)

        # Create chat_messages table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                role TEXT,
                message TEXT,
                created_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
            )
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id_id ON chat_messages(session_id, id);
        """)

    def down(self, conn: sqlite3.Connection) -> None:
        conn.execute("DROP TABLE IF EXISTS chat_messages")
        conn.execute("DROP TABLE IF EXISTS chat_sessions") 