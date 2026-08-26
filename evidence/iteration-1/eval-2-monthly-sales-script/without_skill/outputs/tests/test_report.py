"""Tests for the pure reporting logic (no database required)."""

from __future__ import annotations

import csv
import sys
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from monthly_sales.report import (  # noqa: E402
    CSV_COLUMNS,
    MonthlySalesRow,
    add_month,
    default_range,
    fill_missing_months,
    month_start,
    subtract_month,
    write_csv,
)


def make_row(month: str, revenue: str = "100.00") -> MonthlySalesRow:
    return MonthlySalesRow(
        month=month,
        currency="THB",
        order_count=2,
        customer_count=2,
        gross_revenue=Decimal(revenue),
        avg_order_value=Decimal(revenue) / 2,
    )


class MonthArithmeticTests(unittest.TestCase):
    def test_add_month_rolls_over_year(self) -> None:
        self.assertEqual(add_month(date(2025, 12, 1)), date(2026, 1, 1))

    def test_subtract_month_rolls_back_year(self) -> None:
        self.assertEqual(subtract_month(date(2026, 1, 1)), date(2025, 12, 1))

    def test_month_start_normalises_day(self) -> None:
        self.assertEqual(month_start(date(2026, 3, 29)), date(2026, 3, 1))

    def test_default_range_excludes_current_partial_month(self) -> None:
        start, end = default_range(date(2026, 8, 24), months=3)
        self.assertEqual(start, date(2026, 5, 1))
        self.assertEqual(end, date(2026, 7, 1))

    def test_default_range_rejects_zero_months(self) -> None:
        with self.assertRaises(ValueError):
            default_range(date(2026, 8, 24), months=0)


class RowMappingTests(unittest.TestCase):
    def test_from_db_row_coerces_types(self) -> None:
        row = MonthlySalesRow.from_db_row(("2026-01", "THB", 3, 2, "900.50", Decimal("300.17")))
        self.assertEqual(row.order_count, 3)
        self.assertEqual(row.gross_revenue, Decimal("900.50"))
        self.assertIsInstance(row.avg_order_value, Decimal)

    def test_from_db_row_rejects_wrong_arity(self) -> None:
        with self.assertRaises(ValueError):
            MonthlySalesRow.from_db_row(("2026-01", "THB"))

    def test_csv_record_formats_money_to_two_places(self) -> None:
        row = MonthlySalesRow.from_db_row(("2026-01", "THB", 1, 1, Decimal("5"), Decimal("5")))
        self.assertEqual(row.as_csv_record()["gross_revenue"], "5.00")


class FillMissingMonthsTests(unittest.TestCase):
    def test_gaps_are_filled_with_zero_rows(self) -> None:
        rows = [make_row("2026-01"), make_row("2026-04")]
        filled = fill_missing_months(rows, date(2026, 1, 1), date(2026, 4, 1), "THB")
        self.assertEqual([r.month for r in filled], ["2026-01", "2026-02", "2026-03", "2026-04"])
        self.assertEqual(filled[1].gross_revenue, Decimal("0.00"))
        self.assertEqual(filled[1].order_count, 0)

    def test_existing_rows_are_preserved(self) -> None:
        filled = fill_missing_months([make_row("2026-02", "250.00")], date(2026, 1, 1), date(2026, 2, 1), "THB")
        self.assertEqual(filled[1].gross_revenue, Decimal("250.00"))


class WriteCsvTests(unittest.TestCase):
    def test_header_and_rows_written(self) -> None:
        with TemporaryDirectory() as tmp:
            path = write_csv([make_row("2026-01", "300.00")], Path(tmp) / "out" / "sales.csv")
            with path.open(encoding="utf-8", newline="") as handle:
                records = list(csv.reader(handle))
        self.assertEqual(records[0], list(CSV_COLUMNS))
        self.assertEqual(records[1][0], "2026-01")
        self.assertEqual(records[1][4], "300.00")

    def test_empty_result_still_writes_header(self) -> None:
        with TemporaryDirectory() as tmp:
            path = write_csv([], Path(tmp) / "sales.csv")
            self.assertEqual(path.read_text(encoding="utf-8").strip(), ",".join(CSV_COLUMNS))

    def test_no_temp_files_left_behind(self) -> None:
        with TemporaryDirectory() as tmp:
            write_csv([make_row("2026-01")], Path(tmp) / "sales.csv")
            self.assertEqual([p.name for p in Path(tmp).iterdir()], ["sales.csv"])


if __name__ == "__main__":
    unittest.main()
