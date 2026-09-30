"""
Database session and initialization.

Uses SQLModel (SQLAlchemy + Pydantic) with SQLite.
The DB file lives at data/spectra.db.
"""

from __future__ import annotations

import logging
from pathlib import Path

from sqlmodel import SQLModel, Session, create_engine

from app.core.config import DATA_DIR

logger = logging.getLogger("spectra.db")

DB_PATH = DATA_DIR / "spectra.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},  # Safe with our async pattern
)


def init_db() -> None:
    """Create all tables. Idempotent."""
    # Import models so SQLModel registers them
    from app.db import models as _models  # noqa: F401

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    SQLModel.metadata.create_all(engine)
    logger.info("Database initialized at %s", DB_PATH)


def get_session() -> Session:
    """Get a new database session. Caller must close it."""
    return Session(engine)
