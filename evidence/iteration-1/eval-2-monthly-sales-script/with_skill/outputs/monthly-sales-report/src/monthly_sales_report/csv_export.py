"""เขียนรายงานเป็น CSV — แยกจาก report layer เพราะรูปแบบไฟล์เปลี่ยนคนละจังหวะกับสูตรคำนวณ."""

from __future__ import annotations

import csv
from decimal import Decimal
from pathlib import Path
from typing import IO, Iterable, Sequence

from .errors import ExportError
from .report import MonthlySalesRow

CSV_HEADER: tuple[str, ...] = (
    "month",
    "order_count",
    "unique_customers",
    "gross_sales",
    "avg_order_value",
    "mom_growth_pct",
)

# Excel บน Windows อ่าน UTF-8 ที่ไม่มี BOM เป็น cp874/cp1252 แล้วภาษาไทยกลายเป็นขยะ
CSV_ENCODING = "utf-8-sig"


def write_csv(rows: Sequence[MonthlySalesRow], destination: Path) -> None:
    """เขียนรายงานลงไฟล์ โดยสร้าง directory ปลายทางให้ถ้ายังไม่มี."""
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("w", encoding=CSV_ENCODING, newline="") as stream:
            write_csv_stream(rows, stream)
    except OSError as cause:
        raise ExportError(f"เขียนไฟล์ {destination} ไม่ได้: {cause}") from cause


def write_csv_stream(rows: Iterable[MonthlySalesRow], stream: IO[str]) -> None:
    """เขียนรายงานลง text stream ที่เปิดไว้แล้ว (ใช้กับ stdout ได้ตรง ๆ)."""
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(CSV_HEADER)
    for row in rows:
        writer.writerow(
            (
                f"{row.month:%Y-%m}",
                row.order_count,
                row.unique_customers,
                _decimal_cell(row.gross_sales),
                _decimal_cell(row.avg_order_value),
                _decimal_cell(row.mom_growth_pct),
            )
        )


def _decimal_cell(value: Decimal | None) -> str:
    """ค่าที่เทียบไม่ได้เขียนเป็นช่องว่าง — ดีกว่าใส่ 0 ที่อ่านแล้วเข้าใจผิดว่ายอดไม่โต."""
    if value is None:
        return ""
    return f"{value:f}"
