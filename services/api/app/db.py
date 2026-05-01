from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.pgbouncer_database_url or settings.database_url,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=settings.db_pool_timeout,
    pool_pre_ping=True,
    connect_args={
        "server_settings": {
            "statement_timeout": str(settings.db_statement_timeout_ms),
            "application_name": "xiaolou-api",
        }
    },
)

read_engine = create_async_engine(
    settings.read_database_url or settings.database_url,
    pool_size=max(5, settings.db_pool_size // 2),
    max_overflow=max(5, settings.db_max_overflow // 2),
    pool_timeout=settings.db_pool_timeout,
    pool_pre_ping=True,
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
ReadSessionLocal = async_sessionmaker(read_engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def get_read_session() -> AsyncIterator[AsyncSession]:
    async with ReadSessionLocal() as session:
        yield session


async def check_database() -> dict[str, object]:
    async with engine.connect() as conn:
        row = (await conn.execute(text("select 1 as ok"))).mappings().one()
        pool = engine.sync_engine.pool
        return {
            "ok": row["ok"] == 1,
            "pool_checked_in": pool.checkedin(),
            "pool_checked_out": pool.checkedout(),
            "pool_size": pool.size(),
            "pool_overflow": pool.overflow(),
        }
