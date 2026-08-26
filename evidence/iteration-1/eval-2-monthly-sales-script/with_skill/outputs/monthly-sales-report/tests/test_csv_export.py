from __future__ import annotations

import csv
import io
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from monthly_sales_report.csv_export import (
    CSV_ENCODING,
    CSV_HEADER,
    write_csv,
    write_csv_stream,
)
from monthly_sales_report.errors import ExportError
from monthly_sales_report.periods import MonthRange
from monthly_sales_report.report import MonthlySalesRow, MonthlyTotals, build_report

PERIOD = MonthRange(date(2026, 1, 1), date(2026, 2, 1))


def sample_rows() -> list[MonthlySalesRow]:
    return build_report(
        [
            MonthlyTotals(date(2026, 1, 1), 10, 7, Decimal("12345.60")),
            MonthlyTotals(date(2026, 2, 1), 12, 9, Decimal("15000.00")),
        ],
        PERIOD,
    )


def test_stream_output_has_header_and_one_row_per_month():
    stream = io.StringIO()
    write_csv_stream(sample_rows(), stream)

    rows = list(csv.reader(io.StringIO(stream.getvalue())))
    assert tuple(rows[0]) == CSV_HEADER
    assert len(rows) == 3
    assert rows[1][:4] == ["2026-01", "10", "7", "12345.60"]
    assert rows[2][3] == "15000.00"


def test_missing_growth_is_written_as_empty_cell():
    stream = io.StringIO()
    write_csv_stream(sample_rows(), stream)
    rows = list(csv.reader(io.StringIO(stream.getvalue())))
    assert rows[1][5] == ""
    assert rows[2][5] == "21.50"


def test_header_is_written_even_when_there_are_no_rows():
    stream = io.StringIO()
    write_csv_stream([], stream)
    assert stream.getvalue() == ",".join(CSV_HEADER) + "\n"


def test_write_csv_creates_missing_directories(tmp_path: Path):
    destination = tmp_path / "reports" / "2026" / "monthly_sales.csv"
    write_csv(sample_rows(), destination)

    content = destination.read_text(encoding=CSV_ENCODING)
    assert content.splitlines()[0] == ",".join(CSV_HEADER)
    # utf-8-sig ต้องมี BOM เพื่อให้ Excel อ่านภาษาไทยได้ถูก
    assert destination.read_bytes().startswith(b"\xef\xbb\xbf")


def test_write_csv_reports_unwritable_destination(tmp_path: Path):
    blocker = tmp_path / "not_a_dir"
    blocker.write_text("i am a file")

    with pytest.raises(ExportError):
        write_csv(sample_rows(), blocker / "sub" / "out.csv")
