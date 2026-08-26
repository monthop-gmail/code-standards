"""Command-line entry point — parse argument, ต่อสายงาน, และเป็น catch-all ชั้นนอกสุด."""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date
from pathlib import Path

from .config import AppConfig
from .csv_export import write_csv, write_csv_stream
from .db import fetch_monthly_totals
from .errors import SalesReportError
from .periods import is_current_month, resolve_month_range
from .report import build_report, total_gross_sales

EXIT_OK = 0
EXIT_EXPECTED_FAILURE = 1
STDOUT_TARGET = "-"

logger = logging.getLogger("monthly_sales_report")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="monthly-sales-report",
        description="ดึงยอดขายรายเดือนจาก PostgreSQL แล้วสรุปเป็นไฟล์ CSV",
    )
    parser.add_argument(
        "--from",
        dest="start_month",
        metavar="YYYY-MM",
        help="เดือนเริ่มต้น (default: ย้อนหลัง 12 เดือนจากเดือนสิ้นสุด)",
    )
    parser.add_argument(
        "--to",
        dest="end_month",
        metavar="YYYY-MM",
        help="เดือนสิ้นสุด แบบรวมเดือนนั้นด้วย (default: เดือนปัจจุบัน)",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="monthly_sales.csv",
        metavar="PATH",
        help=f"ไฟล์ CSV ปลายทาง ใช้ {STDOUT_TARGET!r} เพื่อพิมพ์ออก stdout "
        "(default: monthly_sales.csv)",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="แสดง log ระดับ INFO (เช่น DSN ที่ถูก mask แล้ว และช่วงเวลาที่ query)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s %(message)s",
        stream=sys.stderr,
    )

    try:
        config = AppConfig.from_env()
        period = resolve_month_range(args.start_month, args.end_month, date.today())
        if is_current_month(period.end_month, date.today()):
            logger.warning(
                "ช่วงรายงานรวมเดือนปัจจุบัน (%s) ซึ่งยังไม่จบเดือน ตัวเลขจึงยังไม่สมบูรณ์",
                f"{period.end_month:%Y-%m}",
            )

        rows = build_report(fetch_monthly_totals(config, period), period)

        if args.output == STDOUT_TARGET:
            write_csv_stream(rows, sys.stdout)
        else:
            destination = Path(args.output).expanduser()
            write_csv(rows, destination)
            print(
                f"เขียน {len(rows)} เดือนลง {destination} "
                f"(ยอดขายรวม {total_gross_sales(rows):,f})",
                file=sys.stderr,
            )
        return EXIT_OK
    except SalesReportError as error:
        print(f"error: {error}", file=sys.stderr)
        return EXIT_EXPECTED_FAILURE


if __name__ == "__main__":
    raise SystemExit(main())
