"""ทดสอบเฉพาะส่วน argument parsing — ส่วนที่แตะ DB ต้องมี psycopg ติดตั้งจริงถึงจะ import ได้."""

from __future__ import annotations

import pytest

pytest.importorskip("psycopg", reason="cli import psycopg ผ่าน db layer")

from monthly_sales_report.cli import build_parser  # noqa: E402


def test_defaults():
    args = build_parser().parse_args([])
    assert args.start_month is None
    assert args.end_month is None
    assert args.output == "monthly_sales.csv"
    assert args.verbose is False


def test_parses_range_and_output():
    args = build_parser().parse_args(["--from", "2026-01", "--to", "2026-06", "-o", "-", "-v"])
    assert (args.start_month, args.end_month, args.output, args.verbose) == (
        "2026-01",
        "2026-06",
        "-",
        True,
    )


def test_unknown_flag_exits():
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--year", "2026"])
