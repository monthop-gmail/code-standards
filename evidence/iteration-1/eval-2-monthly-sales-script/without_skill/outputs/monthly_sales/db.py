"""Thin PostgreSQL access layer.

``psycopg`` is imported lazily so the pure-logic modules and their tests run
without the driver installed.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from datetime import date
from typing import Iterator, Protocol

from .config import DatabaseConfig
from .queries import MONTHLY_SALES_SQL, REVENUE_STATUSES
from .report import MonthlySalesRow, add_month

logger = logging.getLogger(__name__)


class DatabaseError(RuntimeError):
    """Raised when the database cannot be reached or the query fails."""


class Cursor(Protocol):  # pragma: no cover - structural typing only
    def execute(self, query: str, params: object = ..., /) -> object: ...
    def fetchall(self) -> list[tuple[object, ...]]: ...


@contextmanager
def connect(config: DatabaseConfig) -> Iterator[object]:
    """Open a read-only connection, yielding it and always closing it."""
    try:
        import psycopg  # noqa: PLC0415 - deliberate lazy import
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise DatabaseError(
            "psycopg is not installed. Run: pip install -r requirements.txt"
        ) from exc

    logger.info("Connecting to %s:%s/%s", config.host, config.port, config.dbname)
    try:
        conn = psycopg.connect(**config.to_conninfo_kwargs())
    except Exception as exc:  # psycopg.OperationalError and friends
        raise DatabaseError(f"could not connect to PostgreSQL: {exc}") from exc

    try:
        conn.read_only = True
        yield conn
    finally:
        conn.close()


def fetch_monthly_sales(
    cursor: Cursor,
    start: date,
    end: date,
    currency: str | None = None,
) -> list[MonthlySalesRow]:
    """Run the aggregation for months in ``[start, end]`` inclusive.

    ``end`` is a month start; it is converted to an exclusive upper bound so
    the whole final month is included regardless of timestamp precision.
    """
    params = {
        "start": start,
        "end_exclusive": add_month(end),
        "statuses": list(REVENUE_STATUSES),
        "currency": currency,
    }
    try:
        cursor.execute(MONTHLY_SALES_SQL, params)
        raw_rows = cursor.fetchall()
    except Exception as exc:
        raise DatabaseError(f"monthly sales query failed: {exc}") from exc

    logger.info("Fetched %d aggregated row(s)", len(raw_rows))
    return [MonthlySalesRow.from_db_row(row) for row in raw_rows]
