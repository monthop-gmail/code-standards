#!/usr/bin/env python3
"""ดึงยอดขายรายเดือนจาก PostgreSQL แล้วสรุปเป็นไฟล์ CSV

ตัวอย่าง:
    export DATABASE_URL="postgresql://user:pass@host:5432/shop"
    python monthly_sales_report.py --start 2025-01 --end 2025-12 -o sales_2025.csv

สมมติฐานเรื่อง schema (แก้ SQL ด้านล่างถ้าไม่ตรง):
    orders(id, customer_id, status text, ordered_at timestamptz, total_amount numeric)
    - เก็บเวลาเป็น timestamptz (UTC) แล้วแปลงเป็นเวลาท้องถิ่นตอนตัดเดือน
    - total_amount = ยอดสุทธิต่อ order หลังหักส่วนลด ยังไม่รวม/หรือรวม VAT ตามที่ระบบต้นทางเก็บ
    - นับเฉพาะ order ที่ status อยู่ใน COUNTED_STATUSES (ไม่นับ cancelled/draft/refunded)
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import re
import sys
from contextlib import closing
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Iterator, Sequence

LOG = logging.getLogger("monthly_sales")

# สถานะที่ถือว่า "ขายแล้วจริง" — ปรับให้ตรงกับ workflow ของระบบต้นทาง
COUNTED_STATUSES: tuple[str, ...] = ("paid", "shipped", "completed")

# เวลาที่เก็บเป็น UTC แต่รายงานยอดขายต้องตัดเดือนตามเวลาที่ร้านเปิดขายจริง
DEFAULT_REPORT_TIMEZONE = "Asia/Bangkok"

# กันไม่ให้ query ค้างยาวถ้าตารางใหญ่/ขาด index — หน่วยเป็น ms
STATEMENT_TIMEOUT_MS = 60_000
CONNECT_TIMEOUT_SECONDS = 10

# [0-9] ไม่ใช่ \d เพราะ \d ของ Python match เลขไทย/เลขอารบิกอินดิกด้วย
MONTH_ARG_PATTERN = re.compile(r"(?P<year>[0-9]{4})-(?P<month>[0-9]{2})")
MIN_YEAR, MAX_YEAR = 1970, 2100

CSV_COLUMNS: tuple[str, ...] = (
    "month",
    "order_count",
    "customer_count",
    "net_sales",
    "avg_order_value",
)

# GROUP BY ที่ฝั่ง DB ไม่ใช่ดึงทุกแถวมานับใน Python — ข้อมูลที่วิ่งกลับมาคือเดือนละแถว
MONTHLY_SALES_SQL = """
    SELECT
        date_trunc('month', o.ordered_at AT TIME ZONE %(tz)s)::date AS month,
        count(*)                                AS order_count,
        count(DISTINCT o.customer_id)           AS customer_count,
        coalesce(sum(o.total_amount), 0)        AS net_sales
    FROM orders AS o
    WHERE o.ordered_at >= (%(start)s::timestamp AT TIME ZONE %(tz)s)
      AND o.ordered_at <  (%(end)s::timestamp AT TIME ZONE %(tz)s)
      AND o.status = ANY(%(statuses)s)
    GROUP BY 1
    ORDER BY 1
"""


@dataclass(frozen=True)
class MonthlySales:
    """ยอดขายของหนึ่งเดือน — `month` คือวันแรกของเดือนตาม report timezone"""

    month: date
    order_count: int
    customer_count: int
    net_sales: Decimal

    @property
    def avg_order_value(self) -> Decimal:
        if self.order_count == 0:
            return Decimal("0.00")
        return _to_money(self.net_sales / self.order_count)

    def as_csv_row(self) -> dict[str, str | int]:
        return {
            "month": self.month.strftime("%Y-%m"),
            "order_count": self.order_count,
            "customer_count": self.customer_count,
            "net_sales": str(_to_money(self.net_sales)),
            "avg_order_value": str(self.avg_order_value),
        }


def _to_money(value: Decimal) -> Decimal:
    """ปัดเป็นทศนิยม 2 ตำแหน่งแบบ half-up (ปัดแบบบัญชี ไม่ใช่ banker's rounding ของ Decimal)"""
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def parse_month(value: str) -> date:
    """แปลง 'YYYY-MM' เป็นวันแรกของเดือน — ใช้เป็น argparse type ด้วย

    บังคับเลขอารบิกและปี ค.ศ. เพราะ `int()` ของ Python รับเลขไทยด้วย ('๒๕๖๘' → 2568)
    ถ้าปล่อยผ่าน รายงานจะออกมาว่างเปล่าโดยไม่มีใครรู้ว่าพิมพ์ปี พ.ศ. มา
    """
    match = MONTH_ARG_PATTERN.fullmatch(value)
    if match is None:
        raise argparse.ArgumentTypeError(
            f"เดือนต้องอยู่ในรูปแบบ YYYY-MM ด้วยเลขอารบิก (เช่น 2025-01) แต่ได้ {value!r}"
        )

    year, month = int(match["year"]), int(match["month"])
    if not MIN_YEAR <= year <= MAX_YEAR:
        raise argparse.ArgumentTypeError(
            f"ปีต้องอยู่ระหว่าง {MIN_YEAR}-{MAX_YEAR} (ใช้ปี ค.ศ. ไม่ใช่ พ.ศ.) แต่ได้ {year}"
        )
    if not 1 <= month <= 12:
        raise argparse.ArgumentTypeError(f"เดือนต้องอยู่ระหว่าง 01-12 แต่ได้ {match['month']!r}")

    return date(year, month, 1)


def next_month(day: date) -> date:
    if day.month == 12:
        return date(day.year + 1, 1, 1)
    return date(day.year, day.month + 1, 1)


def iter_months(start: date, end_exclusive: date) -> Iterator[date]:
    current = start
    while current < end_exclusive:
        yield current
        current = next_month(current)


def fill_missing_months(
    rows: Sequence[MonthlySales], start: date, end_exclusive: date
) -> list[MonthlySales]:
    """เติมเดือนที่ไม่มี order ให้เป็นศูนย์

    เดือนที่หายไปเงียบ ๆ ใน CSV ทำให้คนอ่านคิดว่าข้อมูลยังไม่มา แทนที่จะรู้ว่าเดือนนั้นขายไม่ได้เลย
    """
    by_month = {row.month: row for row in rows}
    return [
        by_month.get(
            month,
            MonthlySales(
                month=month,
                order_count=0,
                customer_count=0,
                net_sales=Decimal("0.00"),
            ),
        )
        for month in iter_months(start, end_exclusive)
    ]


def fetch_monthly_sales(
    dsn: str, start: date, end_exclusive: date, timezone_name: str
) -> list[MonthlySales]:
    """ดึงยอดรวมรายเดือนจาก PostgreSQL (aggregate ที่ฝั่ง DB, parameterized ทั้งหมด)"""
    try:
        import psycopg2  # import ตรงนี้เพื่อให้ logic ส่วนคำนวณ/ฟอร์แมต test ได้โดยไม่ต้องมี driver
    except ImportError as cause:  # pragma: no cover - ขึ้นกับ environment
        raise RuntimeError(
            "ต้องติดตั้ง psycopg2-binary ก่อน: pip install psycopg2-binary"
        ) from cause

    params = {
        "tz": timezone_name,
        "start": start,
        "end": end_exclusive,
        "statuses": list(COUNTED_STATUSES),
    }

    LOG.info(
        "querying monthly sales start=%s end_exclusive=%s tz=%s",
        start,
        end_exclusive,
        timezone_name,
    )
    # `with psycopg2.connect(...)` ปิดแค่ transaction ไม่ได้ปิด connection — ต้อง closing() ครอบอีกชั้น
    with closing(psycopg2.connect(dsn, connect_timeout=CONNECT_TIMEOUT_SECONDS)) as connection:
        with connection, connection.cursor() as cursor:
            cursor.execute("SET statement_timeout = %s", (STATEMENT_TIMEOUT_MS,))
            cursor.execute(MONTHLY_SALES_SQL, params)
            records = cursor.fetchall()

    return [
        MonthlySales(
            month=month,
            order_count=int(order_count),
            customer_count=int(customer_count),
            net_sales=Decimal(net_sales),
        )
        for month, order_count, customer_count, net_sales in records
    ]


def write_csv(rows: Sequence[MonthlySales], output_path: Path) -> None:
    """เขียน CSV แบบ utf-8-sig เพื่อให้ Excel บน Windows อ่านภาษาไทยได้โดยไม่เพี้ยน"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow(row.as_csv_row())


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="สรุปยอดขายรายเดือนจาก PostgreSQL ออกเป็น CSV"
    )
    parser.add_argument(
        "--start", required=True, type=parse_month, help="เดือนเริ่มต้น (YYYY-MM) รวมเดือนนี้"
    )
    parser.add_argument(
        "--end", required=True, type=parse_month, help="เดือนสุดท้าย (YYYY-MM) รวมเดือนนี้"
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("monthly_sales.csv"),
        help="ที่อยู่ไฟล์ CSV ผลลัพธ์ (ค่าเริ่มต้น: monthly_sales.csv)",
    )
    parser.add_argument(
        "--timezone",
        default=os.environ.get("REPORT_TIMEZONE", DEFAULT_REPORT_TIMEZONE),
        help=f"timezone ที่ใช้ตัดเดือน (ค่าเริ่มต้น: {DEFAULT_REPORT_TIMEZONE})",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )
    args = build_parser().parse_args(argv)

    if args.start > args.end:
        LOG.error("--start (%s) ต้องไม่มากกว่า --end (%s)", args.start, args.end)
        return 2

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        LOG.error("ไม่พบ environment variable DATABASE_URL (ดูตัวอย่างใน .env.example)")
        return 2

    end_exclusive = next_month(args.end)
    try:
        rows = fetch_monthly_sales(dsn, args.start, end_exclusive, args.timezone)
    except Exception:
        # ไม่ log ตัว dsn เพราะมี password อยู่ข้างใน — stack trace พอให้ไล่ปัญหาได้แล้ว
        LOG.exception("ดึงข้อมูลยอดขายไม่สำเร็จ (start=%s end=%s)", args.start, args.end)
        return 1

    report = fill_missing_months(rows, args.start, end_exclusive)
    write_csv(report, args.output)

    total = _to_money(sum((row.net_sales for row in report), Decimal("0")))
    LOG.info("เขียน %d เดือนลง %s (ยอดรวม %s)", len(report), args.output, total)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
