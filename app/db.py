from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from functools import lru_cache
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings


class Base(DeclarativeBase):
    """Base model for SQLAlchemy declarative mappings."""


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()

    engine_kwargs: dict[str, object] = {"future": True}
    if settings.database_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
        engine_kwargs["connect_args"] = connect_args
        if settings.database_url == "sqlite:///:memory:":
            engine_kwargs["poolclass"] = StaticPool

    return create_engine(settings.database_url, **engine_kwargs)


@lru_cache
def get_session_factory():
    engine = get_engine()
    return sessionmaker(
        bind=engine, autocommit=False, autoflush=False, future=True, expire_on_commit=False
    )


def reset_db_state() -> None:
    """Clear cached engine/session factory (useful in tests)."""
    get_session_factory.cache_clear()
    get_engine.cache_clear()


def create_all() -> None:
    """Create database tables."""
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=get_engine())


def drop_all() -> None:
    """Drop all database tables."""
    Base.metadata.drop_all(bind=get_engine())


@contextmanager
def session_scope() -> Iterator["Session"]:
    """Provide a transactional scope for service or task code."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Generator["Session", None, None]:
    """FastAPI dependency to provide a DB session per request."""
    with session_scope() as session:
        yield session
