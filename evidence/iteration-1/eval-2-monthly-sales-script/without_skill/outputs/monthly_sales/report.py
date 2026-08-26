"""Pure domain logic: row model, month helpers and CSV rendering.

This module has no database dependency, which keeps it trivially testable.
"""

from __future__ import annotations

import csv
import os
from dataclasses import dataclass, fields
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Iterable, Sequence

CSV_COLUMNS: tuple[str, ...] = (
    "month",
    "currency",
    "order_count",
    "customer_count",
    "gross_revenue",
    "avg_order_value",
)


@dataclass(frozen=True, slots=True)
class MonthlySalesRow:
    """One aggregated month (per currency)."""

    month: str
    currency: str
    order_count: int
    customer_count: int
    gross_revenue: Decimal
    avg_order_value: Decimal

    @classmethod
    def from_db_row(cls, row: Sequence[object]) -> "MonthlySalesRow":
        expected = len(fields(cls))
        if len(row) != expected:
            raise ValueError(f"expected {expected} columns, got {len(row)}")
        return cls(
            month=str(row[0]),
            currency=str(row[1]),
            order_count=int(row[2]),  # type: ignore[arg-type]
            customer_count=int(row[3]),  # type: ignore[arg-type]
            gross_revenue=_as_decimal(row[4]),
            avg_order_value=_as_decimal(row[5]),
        )

    def as_csv_record(self) -> dict[str, str]:
        return {
            "month": self.month,
            "currency": self.currency,
            "order_count": str(self.order_count),
            "customer_count": str(self.customer_count),
            "gross_revenue": f"{self.gross_revenue:.2f}",
            "avg_order_value": f"{self.avg_order_value:.2f}",
        }


def _as_decimal(value: object) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, str)):
        return Decimal(value)
    if isinstance(value, float):
        return Decimal(str(value))
    raise TypeError(f"cannot convert {type(value).__name__} to Decimal")


def month_start(value: date) -> date:
    """Return the first day of ``value``'s month."""
    return value.replace(day=1)


def add_month(value: date) -> date:
    """Return the first day of the month after ``value``'s month."""
    return date(value.year + (value.month // 12), (value.month % 12) + 1, 1)


def default_range(today: date, months: int) -> tuple[date, date]:
    """Return (start, end) covering the ``months`` complete months before ``today``.

    The current, still-running month is excluded so the report never mixes a
    partial month with complete ones.
    """
    if months < 1:
        raise ValueError("months must be >= 1")
    end = month_start(today)  # exclusive-ish: last full month is end - 1 month
    start = end
    for _ in range(months):
        start = subtract_month(start)
    return start, subtract_month(end)


def subtract_month(value: date) -> date:
    """Return the first day of the month before ``value``'s month."""
    if value.month == 1:
        return date(value.year - 1, 12, 1)
    return date(value.year, value.month - 1, 1)


def fill_missing_months(
    rows: Iterable[MonthlySalesRow], start: date, end: date, currency: str
) -> list[MonthlySalesRow]:
    """Insert zero rows for months with no sales so the CSV has no gaps."""
    by_month = {row.month: row for row in rows}
    filled: list[MonthlySalesRow] = []
    cursor = month_start(start)
    last = month_start(end)
    while cursor <= last:
        key = cursor.strftime("%Y-%m")
        filled.append(
            by_month.get(
                key,
                MonthlySalesRow(
                    month=key,
                    currency=currency,
                    order_count=0,
                    customer_count=0,
                    gross_revenue=Decimal("0.00"),
                    avg_order_value=Decimal("0.00"),
                ),
            )
        )
        cursor = add_month(cursor)
    return filled


def write_csv(rows: Sequence[MonthlySalesRow], destination: Path) -> Path:
    """Write ``rows`` to ``destination`` atomically and return the path.

    A temporary file in the same directory is renamed into place so a crash
    mid-write never leaves a truncated report behind.
    """
    destination = destination.expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_name(destination.name + f".tmp-{os.getpid()}")

    try:
        with tmp.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
            writer.writeheader()
            for row in rows:
                writer.writerow(row.as_csv_record())
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, destination)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return destination
