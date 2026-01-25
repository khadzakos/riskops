from __future__ import annotations

import os

from sqlalchemy import Engine, create_engine, text


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


def get_engine() -> Engine:
    # Use SQLAlchemy connectables (works well with pandas.read_sql)
    return create_engine(get_database_url(), pool_pre_ping=True)


def db_ping(engine: Engine) -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False

