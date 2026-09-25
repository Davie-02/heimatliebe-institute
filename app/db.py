"""Async database engine and session helpers (PostgreSQL in production, SQLite locally)."""
from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import settings

_url, _connect_args = settings.database
_engine_kwargs: dict = {}
if settings.is_sqlite:
    _engine_kwargs["connect_args"] = {"timeout": 30}
else:
    # Small pool: free Postgres tiers allow few connections; async I/O keeps each one busy.
    _engine_kwargs.update(pool_size=5, max_overflow=10, pool_pre_ping=True, pool_recycle=1800,
                          connect_args=_connect_args)

engine = create_async_engine(_url, **_engine_kwargs)

if settings.is_sqlite:
    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - driver hook
        cur = dbapi_conn.cursor()
        # WAL lets readers and the writer work concurrently; NORMAL sync is safe with WAL.
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.execute("PRAGMA cache_size=-20000")
        cur.close()

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    from . import models  # noqa: F401  (register tables)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)
