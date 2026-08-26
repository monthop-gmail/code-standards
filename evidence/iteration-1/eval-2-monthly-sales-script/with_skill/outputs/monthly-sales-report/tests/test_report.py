from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from monthly_sales_report.errors import ReportError
from monthly_sales_report.periods import MonthRange
from monthly_sales_report.report import (
    MonthlyTotals,
    build_report,
    total_gross_sales,
)

Q1 = MonthRange(date(2026, 1, 1), date(2026, 3, 1))


def totals(month: date, orders: int, customers: int, sales: str) -> MonthlyTotals:
    return MonthlyTotals(
        month=month,
        order_count=orders,
        unique_customers=customers,
        gross_sales=Decimal(sales),
    )


def test_empty_result_still_returns_every_month():
    rows = build_report([], Q1)

    assert [row.month for row in rows] == [date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1)]
    assert all(row.gross_sales == Decimal("0.00") for row in rows)
    assert all(row.order_count == 0 for row in rows)
    assert all(row.avg_order_value == Decimal("0.00") for row in rows)
    assert all(row.mom_growth_pct is None for row in rows)


def test_missing_month_is_filled_with_zero_and_breaks_growth_chain():
    rows = build_report(
        [
            totals(date(2026, 1, 1), 10, 8, "1000.00"),
            totals(date(2026, 3, 1), 5, 5, "500.00"),
        ],
        Q1,
    )

    assert rows[1].gross_sales == Decimal("0.00")
    assert rows[1].mom_growth_pct == Decimal("-100.00")
    # เดือนก่อนหน้ายอดเป็นศูนย์ → หารไม่ได้ ต้องปล่อยว่างแทนที่จะรายงานเป็น 100%
    assert rows[2].mom_growth_pct is None


def test_first_month_has_no_growth_baseline():
    rows = build_report([totals(date(2026, 1, 1), 2, 2, "100.00")], Q1)
    assert rows[0].mom_growth_pct is None


def test_growth_percentage_is_rounded_to_two_decimals():
    rows = build_report(
        [
            totals(date(2026, 1, 1), 3, 3, "300.00"),
            totals(date(2026, 2, 1), 4, 3, "412.35"),
        ],
        Q1,
    )
    assert rows[1].mom_growth_pct == Decimal("37.45")


def test_average_order_value_uses_decimal_rounding_not_float():
    rows = build_report([totals(date(2026, 1, 1), 3, 3, "100.00")], Q1)
    assert rows[0].avg_order_value == Decimal("33.33")


def test_average_order_value_rounds_half_up():
    rows = build_report([totals(date(2026, 1, 1), 2, 2, "0.05")], Q1)
    assert rows[0].avg_order_value == Decimal("0.03")


def test_negative_sales_from_refund_heavy_month_is_kept():
    rows = build_report(
        [
            totals(date(2026, 1, 1), 4, 4, "400.00"),
            totals(date(2026, 2, 1), 1, 1, "-50.00"),
        ],
        Q1,
    )
    assert rows[1].gross_sales == Decimal("-50.00")
    assert rows[1].mom_growth_pct == Decimal("-112.50")
    assert rows[2].mom_growth_pct is None


def test_duplicate_month_is_rejected():
    with pytest.raises(ReportError, match="ซ้ำ"):
        build_report(
            [totals(date(2026, 1, 1), 1, 1, "10.00"), totals(date(2026, 1, 1), 2, 2, "20.00")],
            Q1,
        )


def test_month_outside_period_is_rejected():
    with pytest.raises(ReportError, match="นอกช่วง"):
        build_report([totals(date(2025, 12, 1), 1, 1, "10.00")], Q1)


def test_negative_order_count_is_rejected():
    with pytest.raises(ReportError):
        build_report([totals(date(2026, 1, 1), -1, 0, "0.00")], Q1)


def test_total_gross_sales_sums_all_months():
    rows = build_report(
        [
            totals(date(2026, 1, 1), 1, 1, "1000.10"),
            totals(date(2026, 2, 1), 1, 1, "2000.20"),
        ],
        Q1,
    )
    assert total_gross_sales(rows) == Decimal("3000.30")


def test_total_of_empty_report_is_zero():
    assert total_gross_sales([]) == Decimal("0.00")
