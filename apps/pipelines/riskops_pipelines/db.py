from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

import psycopg2
from psycopg2.extensions import connection as Connection
from sqlalchemy import Engine, create_engine


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


@contextmanager
def db_conn() -> Iterator[Connection]:
    conn = psycopg2.connect(get_database_url())
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_engine() -> Engine:
    # pandas prefers SQLAlchemy connectables over raw DB-API connections
    return create_engine(get_database_url(), pool_pre_ping=True)

