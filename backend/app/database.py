"""Database session management."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

try:  # pragma: no cover - optional dependency
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session, declarative_base, sessionmaker

    SQLALCHEMY_AVAILABLE = True
except ModuleNotFoundError:  # pragma: no cover - lightweight fallback
    SQLALCHEMY_AVAILABLE = False
    Session = object  # type: ignore[assignment]

from .config import get_settings

settings = get_settings()

if SQLALCHEMY_AVAILABLE:
    engine = create_engine(settings.database_url, future=True, echo=False, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=engine, class_=Session, expire_on_commit=False, future=True)
    Base = declarative_base()

    @contextmanager
    def get_session() -> Iterator[Session]:
        """Provide a transactional scope around a series of operations."""

        session = SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

else:
    engine = None
    Base = object()

    @contextmanager
    def get_session() -> Iterator[None]:  # type: ignore[override]
        yield None
