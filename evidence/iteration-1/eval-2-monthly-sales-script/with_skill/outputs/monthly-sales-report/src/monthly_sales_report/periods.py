"""Pure logic ของ "ช่วงเดือน" — ไม่มี IO ไม่มี DB จึง test ได้เร็วและครบทุก edge case."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from .errors import InvalidPeriodError

MONTH_PATTERN = re.compile(r"^(\d{4})-(\d{2})$")
DEFAULT_MONTHS_BACK = 12
MAX_MONTHS_IN_RANGE = 240


def parse_month(text: str) -> date:
    """แปลง ``"2026-08"`` เป็นวันที่แรกของเดือนนั้น."""
    match = MONTH_PATTERN.match(text.strip())
    if match is None:
        raise InvalidPeriodError(f"เดือน {text!r} ต้องอยู่ในรูปแบบ YYYY-MM เช่น 2026-08")
    year, month = int(match.group(1)), int(match.group(2))
    if not 1 <= month <= 12:
        raise InvalidPeriodError(f"เดือน {text!r} ต้องอยู่ระหว่าง 01 ถึง 12")
    if not 1 <= year <= 9999:
        raise InvalidPeriodError(f"ปี {year} อยู่นอกช่วงที่รองรับ")
    return date(year, month, 1)


def first_day_of_month(value: date) -> date:
    return value.replace(day=1)


def add_months(month_start: date, delta: int) -> date:
    """บวก/ลบเดือนโดยไม่พึ่ง dateutil — ทำงานกับวันที่ 1 ของเดือนเท่านั้น."""
    zero_based = month_start.year * 12 + (month_start.month - 1) + delta
    year, month_index = divmod(zero_based, 12)
    if not 1 <= year <= 9999:
        raise InvalidPeriodError(f"การเลื่อนเดือน {delta} เดือนทำให้ปีอยู่นอกช่วงที่รองรับ")
    return date(year, month_index + 1, 1)


@dataclass(frozen=True)
class MonthRange:
    """ช่วงเดือนแบบ inclusive ทั้งสองฝั่ง เก็บเป็นวันที่ 1 ของเดือนเสมอ."""

    start_month: date
    end_month: date

    def __post_init__(self) -> None:
        if self.start_month.day != 1 or self.end_month.day != 1:
            raise InvalidPeriodError("MonthRange ต้องรับวันที่ 1 ของเดือนเท่านั้น")
        if self.start_month > self.end_month:
            raise InvalidPeriodError(
                f"เดือนเริ่ม {self.start_month:%Y-%m} "
                f"ต้องไม่เกินเดือนสิ้นสุด {self.end_month:%Y-%m}"
            )
        if self.month_count > MAX_MONTHS_IN_RANGE:
            raise InvalidPeriodError(
                f"ช่วงเวลากว้าง {self.month_count} เดือน เกินเพดาน {MAX_MONTHS_IN_RANGE} เดือน"
            )

    @property
    def month_count(self) -> int:
        start = self.start_month.year * 12 + self.start_month.month
        end = self.end_month.year * 12 + self.end_month.month
        return end - start + 1

    def months(self) -> list[date]:
        """ทุกเดือนในช่วง เรียงจากเก่าไปใหม่ — ใช้เติมเดือนที่ไม่มียอดขายให้ครบ."""
        return [add_months(self.start_month, offset) for offset in range(self.month_count)]

    def to_utc_bounds(self, timezone: ZoneInfo) -> tuple[datetime, datetime]:
        """คืนขอบเขต ``[start, end)`` เป็น timestamp with time zone.

        ใช้ half-open interval เพื่อให้ query ยัง sargable (ใช้ index บน order_date ได้)
        และไม่ต้องกังวลว่าเดือนนั้นมี 28/29/30/31 วัน
        """
        start = datetime.combine(self.start_month, datetime.min.time(), tzinfo=timezone)
        end = datetime.combine(add_months(self.end_month, 1), datetime.min.time(), tzinfo=timezone)
        return start, end


def resolve_month_range(
    start_text: str | None,
    end_text: str | None,
    today: date,
    months_back: int = DEFAULT_MONTHS_BACK,
) -> MonthRange:
    """ตีความ argument ``--from``/``--to`` ให้เป็นช่วงเดือนที่ชัดเจน.

    ค่า default: เดือนสิ้นสุด = เดือนปัจจุบัน, เดือนเริ่ม = ย้อนหลัง ``months_back`` เดือน
    (รวมเดือนปัจจุบันซึ่งยังไม่จบ — CLI จะเตือนผู้ใช้เอง)
    """
    if months_back < 1:
        raise InvalidPeriodError("months_back ต้องมากกว่า 0")

    end_month = parse_month(end_text) if end_text else first_day_of_month(today)
    start_month = (
        parse_month(start_text) if start_text else add_months(end_month, -(months_back - 1))
    )
    return MonthRange(start_month=start_month, end_month=end_month)


def is_current_month(month: date, today: date) -> bool:
    return first_day_of_month(month) == first_day_of_month(today)
