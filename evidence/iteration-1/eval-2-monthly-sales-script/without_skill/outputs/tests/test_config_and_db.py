"""Tests for configuration parsing, CLI range resolution and the query layer."""

from __future__ import annotations

import sys
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from monthly_sales.cli import build_parser, resolve_range  # noqa: E402
from monthly_sales.config import ConfigError, DatabaseConfig, ReportRequest  # noqa: E402
from monthly_sales.db import DatabaseError, fetch_monthly_sales  # noqa: E402
from monthly_sales.queries import MONTHLY_SALES_SQL, REVENUE_STATUSES  # noqa: E402

BASE_ENV = {
    "PGDATABASE": "sales",
    "PGUSER": "reader",
    "PGPASSWORD": "s3cret",
}


class FakeCursor:
    """Minimal stand-in for a psycopg cursor."""

    def __init__(self, rows: list[tuple[object, ...]] | None = None, error: Exception | None = None):
        self._rows = rows or []
        self._error = error
        self.executed: list[tuple[str, object]] = []

    def execute(self, query: str, params: object = None, /) -> None:
        if self._error is not None:
            raise self._error
        self.executed.append((query, params))

    def fetchall(self) -> list[tuple[object, ...]]:
        return self._rows


class DatabaseConfigTests(unittest.TestCase):
    def test_defaults_applied(self) -> None:
        config = DatabaseConfig.from_env(dict(BASE_ENV))
        self.assertEqual(config.host, "localhost")
        self.assertEqual(config.port, 5432)

    def test_missing_required_vars_are_reported_together(self) -> None:
        with self.assertRaises(ConfigError) as ctx:
            DatabaseConfig.from_env({"PGUSER": "reader"})
        self.assertIn("PGDATABASE", str(ctx.exception))
        self.assertIn("PGPASSWORD", str(ctx.exception))

    def test_invalid_port_rejected(self) -> None:
        with self.assertRaises(ConfigError):
            DatabaseConfig.from_env({**BASE_ENV, "PGPORT": "not-a-number"})

    def test_non_positive_timeout_rejected(self) -> None:
        with self.assertRaises(ConfigError):
            DatabaseConfig.from_env({**BASE_ENV, "DB_CONNECT_TIMEOUT": "0"})

    def test_password_not_exposed_in_repr(self) -> None:
        config = DatabaseConfig.from_env({**BASE_ENV, "PGPASSWORD": "hunter2"})
        self.assertNotIn("hunter2", repr(config))

    def test_conninfo_sets_statement_timeout(self) -> None:
        kwargs = DatabaseConfig.from_env(dict(BASE_ENV)).to_conninfo_kwargs()
        self.assertIn("statement_timeout=60000", str(kwargs["options"]))


class ReportRequestTests(unittest.TestCase):
    def test_reversed_range_rejected(self) -> None:
        with self.assertRaises(ConfigError):
            ReportRequest(start=date(2026, 5, 1), end=date(2026, 1, 1))

    def test_start_must_be_month_start(self) -> None:
        with self.assertRaises(ConfigError):
            ReportRequest(start=date(2026, 5, 15), end=date(2026, 6, 1))


class CliRangeTests(unittest.TestCase):
    def test_explicit_range_used_verbatim(self) -> None:
        args = build_parser().parse_args(["--start", "2025-01", "--end", "2025-06"])
        self.assertEqual(resolve_range(args, date(2026, 8, 24)), (date(2025, 1, 1), date(2025, 6, 1)))

    def test_default_range_is_last_n_full_months(self) -> None:
        args = build_parser().parse_args(["--months", "2"])
        self.assertEqual(resolve_range(args, date(2026, 8, 24)), (date(2026, 6, 1), date(2026, 7, 1)))

    def test_bad_month_format_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            build_parser().parse_args(["--start", "2026/01"])


class FetchMonthlySalesTests(unittest.TestCase):
    def test_parameters_are_bound_not_interpolated(self) -> None:
        cursor = FakeCursor(rows=[])
        fetch_monthly_sales(cursor, date(2026, 1, 1), date(2026, 3, 1), "THB")
        query, params = cursor.executed[0]
        self.assertEqual(query, MONTHLY_SALES_SQL)
        assert isinstance(params, dict)
        self.assertEqual(params["start"], date(2026, 1, 1))
        # End month must be expanded to an exclusive upper bound.
        self.assertEqual(params["end_exclusive"], date(2026, 4, 1))
        self.assertEqual(params["statuses"], list(REVENUE_STATUSES))
        self.assertEqual(params["currency"], "THB")

    def test_rows_are_mapped_to_domain_objects(self) -> None:
        cursor = FakeCursor(rows=[("2026-01", "THB", 4, 3, Decimal("1200.00"), Decimal("300.00"))])
        rows = fetch_monthly_sales(cursor, date(2026, 1, 1), date(2026, 1, 1))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].customer_count, 3)

    def test_driver_errors_wrapped(self) -> None:
        cursor = FakeCursor(error=RuntimeError("connection reset"))
        with self.assertRaises(DatabaseError):
            fetch_monthly_sales(cursor, date(2026, 1, 1), date(2026, 1, 1))


if __name__ == "__main__":
    unittest.main()
