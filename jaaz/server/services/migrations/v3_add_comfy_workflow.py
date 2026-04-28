from . import Migration
import sqlite3


class V3AddComfyWorkflow(Migration):
    version = 3
    description = "Add comfy workflow"

    def up(self, conn: sqlite3.Connection) -> None:
        # Create comfy workflow table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS comfy_workflows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                api_json TEXT,
                description TEXT DEFAULT '',
                inputs TEXT,
                outputs TEXT,
                created_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_comfy_workflows_updated_at ON comfy_workflows(updated_at DESC, id DESC)
        """)



    def down(self, conn: sqlite3.Connection) -> None:
        pass