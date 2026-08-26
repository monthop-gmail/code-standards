from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from monthly_sales_report.errors import InvalidPeriodError
from monthly_sales_report.periods import (
    MAX_MONTHS_IN_RANGE,
    MonthRange,
    add_months,
    is_current_month,
    parse_month,
    resolve_month_range,
)

BANGKOK = ZoneInfo("Asia/Bangkok")


def test_parse_month_returns_first_day():
    assert parse_month("2026-08") == date(2026, 8, 1)
    assert parse_month("  2026-01  ") == date(2026, 1, 1)


@pytest.mark.parametrize("text", ["", "2026", "2026-8", "2026-13", "2026-00", "ส.ค. 2026", "26-08"])
def test_parse_month_rejects_bad_input(text):
    with pytest.raises(InvalidPeriodError):
        parse_month(text)


def test_add_months_crosses_year_boundaries():
    assert add_months(date(2026, 12, 1), 1) == date(2027, 1, 1)
    assert add_months(date(2026, 1, 1), -1) == date(2025, 12, 1)
    assert add_months(date(2026, 8, 1), 0) == date(2026, 8, 1)
    assert add_months(date(2026, 8, 1), -19) == date(2025, 1, 1)


def test_add_months_outside_supported_years_raises():
    with pytest.raises(InvalidPeriodError):
        add_months(date(1, 1, 1), -1)


def test_month_range_single_month():
    period = MonthRange(date(2026, 2, 1), date(2026, 2, 1))
    assert period.month_count == 1
    assert period.months() == [date(2026, 2, 1)]


def test_month_range_rejects_reversed_range():
    with pytest.raises(InvalidPeriodError):
        MonthRange(date(2026, 8, 1), date(2026, 7, 1))


def test_month_range_rejects_non_first_day():
    with pytest.raises(InvalidPeriodError):
        MonthRange(date(2026, 8, 15), date(2026, 9, 1))


def test_month_range_rejects_absurdly_wide_range():
    start = date(2000, 1, 1)
    end = add_months(start, MAX_MONTHS_IN_RANGE)
    with pytest.raises(InvalidPeriodError):
        MonthRange(start, end)


def test_utc_bounds_are_half_open_and_timezone_aware():
    period = MonthRange(date(2026, 1, 1), date(2026, 2, 1))
    start, end = period.to_utc_bounds(BANGKOK)

    assert start == datetime(2026, 1, 1, tzinfo=BANGKOK)
    assert end == datetime(2026, 3, 1, tzinfo=BANGKOK)
    # ออเดอร์ตอนเที่ยงคืนตรงของวันที่ 1 มี.ค. ต้องไม่ถูกนับเข้าเดือน ก.พ.
    assert datetime(2026, 2, 28, 23, 59, tzinfo=BANGKOK) < end
    assert not datetime(2026, 3, 1, 0, 0, tzinfo=BANGKOK) < end


def test_utc_bounds_handles_december_rollover():
    period = MonthRange(date(2026, 12, 1), date(2026, 12, 1))
    _, end = period.to_utc_bounds(BANGKOK)
    assert end == datetime(2027, 1, 1, tzinfo=BANGKOK)


def test_resolve_defaults_to_trailing_twelve_months():
    period = resolve_month_range(None, None, today=date(2026, 8, 24))
    assert period.start_month == date(2025, 9, 1)
    assert period.end_month == date(2026, 8, 1)
    assert period.month_count == 12


def test_resolve_uses_explicit_bounds():
    period = resolve_month_range("2026-01", "2026-03", today=date(2026, 8, 24))
    assert period.months() == [date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1)]


def test_resolve_with_only_start_runs_to_current_month():
    period = resolve_month_range("2026-06", None, today=date(2026, 8, 24))
    assert period.end_month == date(2026, 8, 1)


def test_resolve_rejects_reversed_bounds():
    with pytest.raises(InvalidPeriodError):
        resolve_month_range("2026-05", "2026-04", today=date(2026, 8, 24))


def test_is_current_month():
    assert is_current_month(date(2026, 8, 1), date(2026, 8, 24))
    assert not is_current_month(date(2026, 7, 1), date(2026, 8, 24))
