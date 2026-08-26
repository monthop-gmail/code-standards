"""ชั้นติดต่อ PostgreSQL — ที่เดียวในโปรเจกต์ที่รู้จัก psycopg และรู้จัก schema จริง."""

from __future__ import annotations

import logging

import psycopg
from psycopg.rows import class_row

from .config import AppConfig, mask_dsn
from .errors import DatabaseError
from .periods import MonthRange
from .report import MonthlyTotals

logger = logging.getLogger(__name__)

# สถานะออเดอร์ที่นับเป็นยอดขาย — draft/cancelled/refunded ไม่นับ
COUNTED_ORDER_STATUSES: tuple[str, ...] = ("paid", "completed", "shipped")

# หมายเหตุ: เดือนถูกตัดตาม timezone ของรายงาน (ไม่ใช่ UTC) เพราะออเดอร์ตอน 4 ทุ่มของวันที่ 31
# ตามเวลาไทย ต้องอยู่ในเดือนนั้น ไม่ใช่เดือนถัดไป
MONTHLY_SALES_SQL = """
SELECT
    (date_trunc('month', o.order_date AT TIME ZONE %(timezone)s))::date AS month,
    count(*)::bigint                                                    AS order_count,
    count(DISTINCT o.customer_id)::bigint                               AS unique_customers,
    coalesce(sum(o.total_amount), 0)::numeric                           AS gross_sales
FROM sales.orders AS o
WHERE o.order_date >= %(start)s
  AND o.order_date <  %(end)s
  AND o.status = ANY(%(statuses)s)
GROUP BY 1
ORDER BY 1
"""


def fetch_monthly_totals(config: AppConfig, period: MonthRange) -> list[MonthlyTotals]:
    """ดึงยอดรวมรายเดือนจาก PostgreSQL.

    การ aggregate ทำฝั่ง DB ทั้งหมด — จำนวนแถวที่วิ่งกลับมาเท่ากับจำนวนเดือน ไม่ใช่จำนวนออเดอร์
    """
    start, end = period.to_utc_bounds(config.timezone)
    params = {
        "timezone": str(config.timezone),
        "start": start,
        "end": end,
        "statuses": list(COUNTED_ORDER_STATUSES),
    }

    logger.info(
        "querying %s for %s..%s (%s)",
        mask_dsn(config.dsn),
        period.start_month.isoformat(),
        period.end_month.isoformat(),
        config.timezone,
    )

    try:
        with psycopg.connect(
            config.dsn,
            connect_timeout=config.connect_timeout_seconds,
            options=f"-c statement_timeout={config.statement_timeout_ms}",
        ) as connection:
            connection.read_only = True
            with connection.cursor(row_factory=class_row(MonthlyTotals)) as cursor:
                cursor.execute(MONTHLY_SALES_SQL, params)
                return cursor.fetchall()
    except psycopg.OperationalError as cause:
        raise DatabaseError(
            f"เชื่อมต่อฐานข้อมูลไม่สำเร็จ ({mask_dsn(config.dsn)}): {cause}"
        ) from cause
    except psycopg.Error as cause:
        raise DatabaseError(f"query ยอดขายรายเดือนล้มเหลว: {cause}") from cause
