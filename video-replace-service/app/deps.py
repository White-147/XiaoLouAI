"""FastAPI dependency providers (DI singletons).

No Redis / ARQ — single-machine MVP uses an in-memory asyncio.Queue that the
main app boot hands off to one background worker task (see app/main.py).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from .config import Settings, get_settings
from .services.storage import Storage
from .services.tasks_db import TasksDB

# ---------------------------------------------------------------------------
# Singletons (module-global)
# ---------------------------------------------------------------------------
_storage: Storage | None = None
_tasks_db: TasksDB | None = None


def get_storage(settings: Annotated[Settings, Depends(get_settings)]) -> Storage:
    global _storage
    if _storage is None:
        _storage = Storage(settings)
    return _storage


async def get_tasks_db(
    settings: Annotated[Settings, Depends(get_settings)],
) -> TasksDB:
    global _tasks_db
    if _tasks_db is None:
        _tasks_db = TasksDB(settings.database_url)
        await _tasks_db.init()
    return _tasks_db


# Re-exports
__all__ = ["get_settings", "get_storage", "get_tasks_db"]
