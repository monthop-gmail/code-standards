"""เทสส่วนที่ผิดแล้วตัวเลขในรายงานผิด: การตัดช่วงเดือน, การเติมเดือนที่ไม่มียอด, การปัดเงิน

ส่วนที่คุยกับ PostgreSQL ไม่ได้ mock ไว้ — ต้องเทสกับ DB จริง/staging ต่างหาก
"""

from __future__ import annotations

import argparse
import csv
from datetime import date
from decimal import Decimal

import pytest

from monthly_sales_report import (
    CSV_COLUMNS,
    MonthlySales,
    fill_missing_months,
    iter_months,
    next_month,
    parse_month,
    write_csv,
)


def make_row(month: date, orders: int = 1, customers: int = 1, net: str = "0.00") -> MonthlySales:
    return MonthlySales(
        month=month,
        order_count=orders,
        customer_count=customers,
        net_sales=Decimal(net),
    )


class TestParseMonth:
    def test_parses_first_day_of_month(self) -> None:
        assert parse_month("2025-03") == date(2025, 3, 1)

    @pytest.mark.parametrize("value", ["2025", "2025-13", "2025-00", "", "2025-01-15", "2025-1"])
    def test_rejects_bad_input(self, value: str) -> None:
        with pytest.raises(argparse.ArgumentTypeError):
            parse_month(value)

    def test_rejects_thai_digits(self) -> None:
        # int('๒๕๖๘') = 2568 ใน Python — ถ้าไม่กันไว้จะได้รายงานว่างโดยไม่มี error
        with pytest.raises(argparse.ArgumentTypeError):
            parse_month("๒๕๖๘-๐๓")

    def test_rejects_buddhist_era_year(self) -> None:
        with pytest.raises(argparse.ArgumentTypeError, match="พ.ศ."):
            parse_month("2568-03")


class TestMonthArithmetic:
    def test_next_month_crosses_year_boundary(self) -> None:
        assert next_month(date(2025, 12, 1)) == date(2026, 1, 1)

    def test_iter_months_is_half_open(self) -> None:
        months = list(iter_months(date(2025, 11, 1), date(2026, 2, 1)))
        assert months == [date(2025, 11, 1), date(2025, 12, 1), date(2026, 1, 1)]

    def test_iter_months_empty_when_range_is_zero_width(self) -> None:
        assert list(iter_months(date(2025, 1, 1), date(2025, 1, 1))) == []


class TestFillMissingMonths:
    def test_inserts_zero_rows_for_months_without_orders(self) -> None:
        rows = [make_row(date(2025, 3, 1), orders=2, net="500.00")]

        filled = fill_missing_months(rows, date(2025, 1, 1), date(2025, 4, 1))

        assert [row.month for row in filled] == [
            date(2025, 1, 1),
            date(2025, 2, 1),
            date(2025, 3, 1),
        ]
        assert filled[0].order_count == 0
        assert filled[0].net_sales == Decimal("0.00")
        assert filled[2].net_sales == Decimal("500.00")

    def test_returns_full_range_when_query_found_nothing(self) -> None:
        filled = fill_missing_months([], date(2025, 1, 1), date(2025, 3, 1))

        assert len(filled) == 2
        assert all(row.order_count == 0 for row in filled)


class TestAvgOrderValue:
    def test_zero_orders_does_not_divide_by_zero(self) -> None:
        assert make_row(date(2025, 1, 1), orders=0).avg_order_value == Decimal("0.00")

    def test_rounds_half_up_not_bankers(self) -> None:
        # 0.125 → 0.13 (Decimal ปกติปัดเป็น 0.12) เพราะฝ่ายบัญชีคาดหวังการปัดขึ้น
        row = make_row(date(2025, 1, 1), orders=2, net="0.25")
        assert row.avg_order_value == Decimal("0.13")

    def test_repeating_decimal_is_truncated_to_two_places(self) -> None:
        row = make_row(date(2025, 1, 1), orders=3, net="100.00")
        assert row.avg_order_value == Decimal("33.33")


class TestWriteCsv:
    def test_writes_header_and_formatted_rows(self, tmp_path) -> None:
        output = tmp_path / "nested" / "sales.csv"

        write_csv([make_row(date(2025, 1, 1), orders=4, customers=3, net="1234.5")], output)

        with output.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))

        assert list(rows[0].keys()) == list(CSV_COLUMNS)
        assert rows[0] == {
            "month": "2025-01",
            "order_count": "4",
            "customer_count": "3",
            "net_sales": "1234.50",
            "avg_order_value": "308.63",
        }

    def test_writes_bom_so_excel_reads_utf8(self, tmp_path) -> None:
        output = tmp_path / "sales.csv"

        write_csv([], output)

        assert output.read_bytes().startswith(b"\xef\xbb\xbf")
