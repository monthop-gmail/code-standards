"""Business logic ของรายงาน — pure function ล้วน ไม่รู้จัก psycopg และไม่รู้จัก CSV.

เก็บเงินเป็น ``Decimal`` ตลอดเส้นทาง (ไม่ใช่ float) เพราะยอดขายที่ปัดผิด 0.01 บาท
แล้วเอาไปกระทบยอดกับฝ่ายบัญชีคือปัญหาที่หาสาเหตุยากที่สุดอย่างหนึ่ง
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from .errors import ReportError
from .periods import MonthRange, first_day_of_month

MONEY_QUANTUM = Decimal("0.01")
PERCENT_QUANTUM = Decimal("0.01")
ZERO = Decimal("0")


@dataclass(frozen=True)
class MonthlyTotals:
    """แถวดิบที่ได้จาก ``GROUP BY`` ฝั่ง PostgreSQL."""

    month: date
    order_count: int
    unique_customers: int
    gross_sales: Decimal


@dataclass(frozen=True)
class MonthlySalesRow:
    """หนึ่งเดือนในรายงาน — ทุกเดือนในช่วงจะมีแถวเสมอ แม้ยอดขายเป็นศูนย์."""

    month: date
    order_count: int
    unique_customers: int
    gross_sales: Decimal
    avg_order_value: Decimal
    mom_growth_pct: Decimal | None


def build_report(totals: list[MonthlyTotals], period: MonthRange) -> list[MonthlySalesRow]:
    """เติมเดือนที่ไม่มียอดขายให้ครบ แล้วคำนวณค่าเฉลี่ยต่อออเดอร์และการเติบโต MoM.

    เดือนที่ไม่มีออเดอร์เลยจะไม่ปรากฏในผล ``GROUP BY`` แต่รายงานต้องมีทุกเดือน
    ไม่งั้นคนอ่านจะเข้าใจผิดว่ากราฟต่อเนื่องทั้งที่มีเดือนหายไป
    """
    totals_by_month: dict[date, MonthlyTotals] = {}
    for entry in totals:
        month = first_day_of_month(entry.month)
        if month in totals_by_month:
            raise ReportError(
                f"ได้ผลลัพธ์ซ้ำสำหรับเดือน {month:%Y-%m} — query ไม่ได้ group by เดือนจริง"
            )
        if not period.start_month <= month <= period.end_month:
            raise ReportError(
                f"ได้เดือน {month:%Y-%m} ซึ่งอยู่นอกช่วง "
                f"{period.start_month:%Y-%m}..{period.end_month:%Y-%m}"
            )
        if entry.order_count < 0 or entry.unique_customers < 0:
            raise ReportError(f"จำนวนออเดอร์/ลูกค้าของเดือน {month:%Y-%m} ติดลบ")
        totals_by_month[month] = entry

    rows: list[MonthlySalesRow] = []
    previous_sales: Decimal | None = None
    for month in period.months():
        entry = totals_by_month.get(month)
        order_count = entry.order_count if entry else 0
        unique_customers = entry.unique_customers if entry else 0
        gross_sales = _to_money(entry.gross_sales if entry else ZERO)

        rows.append(
            MonthlySalesRow(
                month=month,
                order_count=order_count,
                unique_customers=unique_customers,
                gross_sales=gross_sales,
                avg_order_value=_average_order_value(gross_sales, order_count),
                mom_growth_pct=_growth_pct(previous_sales, gross_sales),
            )
        )
        previous_sales = gross_sales

    return rows


def total_gross_sales(rows: list[MonthlySalesRow]) -> Decimal:
    return _to_money(sum((row.gross_sales for row in rows), start=ZERO))


def _average_order_value(gross_sales: Decimal, order_count: int) -> Decimal:
    if order_count <= 0:
        return _to_money(ZERO)
    return _to_money(gross_sales / Decimal(order_count))


def _growth_pct(previous_sales: Decimal | None, current_sales: Decimal) -> Decimal | None:
    """คืน ``None`` เมื่อเทียบไม่ได้ (เดือนแรกของช่วง หรือเดือนก่อนหน้ายอดเป็นศูนย์).

    การหารด้วยศูนย์แล้วรายงานว่า "โต 100%" เป็นตัวเลขที่หลอกคนอ่าน — ปล่อยว่างตรงไปตรงมากว่า
    """
    if previous_sales is None or previous_sales <= ZERO:
        return None
    change = (current_sales - previous_sales) / previous_sales * Decimal(100)
    return change.quantize(PERCENT_QUANTUM, rounding=ROUND_HALF_UP)


def _to_money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
