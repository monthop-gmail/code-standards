"""Command-line entry point for the monthly sales CSV export."""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, datetime
from pathlib import Path

from .config import ConfigError, DatabaseConfig, ReportRequest
from .db import DatabaseError, connect, fetch_monthly_sales
from .report import default_range, fill_missing_months, month_start, write_csv

EXIT_OK = 0
EXIT_CONFIG_ERROR = 2
EXIT_DB_ERROR = 3

logger = logging.getLogger("monthly_sales")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="monthly-sales",
        description="Summarise monthly sales from PostgreSQL into a CSV file.",
    )
    parser.add_argument(
        "--start",
        type=_month_arg,
        help="First month to include, YYYY-MM (default: --months before last full month).",
    )
    parser.add_argument(
        "--end",
        type=_month_arg,
        help="Last month to include, YYYY-MM (default: last full month).",
    )
    parser.add_argument(
        "--months",
        type=int,
        default=12,
        help="How many full months back to report when --start/--end are omitted (default: 12).",
    )
    parser.add_argument(
        "--currency",
        help="Restrict to a single ISO-4217 currency, e.g. THB. Default: all currencies.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("monthly_sales.csv"),
        help="Destination CSV path (default: ./monthly_sales.csv).",
    )
    parser.add_argument(
        "--fill-gaps",
        action="store_true",
        help="Emit zero rows for months with no sales (requires --currency).",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging.")
    return parser


def _month_arg(raw: str) -> date:
    try:
        return datetime.strptime(raw, "%Y-%m").date().replace(day=1)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM, got {raw!r}") from exc


def resolve_range(args: argparse.Namespace, today: date) -> tuple[date, date]:
    """Turn CLI arguments into an inclusive (start, end) month range."""
    if args.start and args.end:
        return args.start, args.end
    default_start, default_end = default_range(today, args.months)
    start = args.start or default_start
    end = args.end or default_end
    return month_start(start), month_start(end)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    )

    try:
        if args.fill_gaps and not args.currency:
            raise ConfigError("--fill-gaps requires --currency so zero rows are unambiguous")
        start, end = resolve_range(args, date.today())
        request = ReportRequest(start=start, end=end, currency=args.currency)
        db_config = DatabaseConfig.from_env()
    except ConfigError as exc:
        logger.error("Configuration error: %s", exc)
        return EXIT_CONFIG_ERROR

    logger.info("Reporting months %s .. %s", request.start, request.end)

    try:
        with connect(db_config) as conn:
            with conn.cursor() as cursor:  # type: ignore[attr-defined]
                rows = fetch_monthly_sales(cursor, request.start, request.end, request.currency)
    except DatabaseError as exc:
        logger.error("Database error: %s", exc)
        return EXIT_DB_ERROR

    if args.fill_gaps and args.currency:
        rows = fill_missing_months(rows, request.start, request.end, args.currency)

    if not rows:
        logger.warning("No sales rows found for the requested range; writing header only.")

    path = write_csv(rows, args.output)
    logger.info("Wrote %d row(s) to %s", len(rows), path)
    return EXIT_OK


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
