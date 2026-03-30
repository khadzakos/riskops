from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import psycopg2
from psycopg2.extensions import connection as Connection
from sqlalchemy import Engine, create_engine

from .config import get_settings


def get_database_url() -> str:
    return get_settings().database_url


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
    return create_engine(get_database_url(), pool_pre_ping=True)
