from typing import Protocol
import sqlite3

class Migration(Protocol):
    """Migration protocol"""
    version: int
    description: str

    def up(self, conn: sqlite3.Connection) -> None:
        """Apply the migration"""
        ...

    def down(self, conn: sqlite3.Connection) -> None:
        """Rollback the migration"""
        ... 