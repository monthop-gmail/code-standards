"""SQL for the monthly sales aggregation.

Assumed schema (adjust the table/column names here if yours differ -- this is
the single place that knows about them):

    orders(
        id            bigint primary key,
        order_date    timestamptz not null,
        status        text not null,          -- 'paid' | 'completed' | 'refunded' | ...
        customer_id   bigint not null,
        currency      char(3) not null,
        total_amount  numeric(12,2) not null  -- gross, incl. tax, excl. shipping
    )

Only revenue-bearing statuses are counted; refunded/cancelled orders are
excluded. All parameters are bound, never interpolated, so the statement is
not vulnerable to SQL injection.
"""

from __future__ import annotations

from typing import Final

REVENUE_STATUSES: Final[tuple[str, ...]] = ("paid", "completed", "shipped")

MONTHLY_SALES_SQL: Final[str] = """
SELECT
    to_char(date_trunc('month', o.order_date), 'YYYY-MM')      AS month,
    o.currency                                                 AS currency,
    count(*)                                                   AS order_count,
    count(DISTINCT o.customer_id)                              AS customer_count,
    coalesce(sum(o.total_amount), 0)::numeric(14, 2)           AS gross_revenue,
    coalesce(avg(o.total_amount), 0)::numeric(14, 2)           AS avg_order_value
FROM orders AS o
WHERE o.order_date >= %(start)s
  AND o.order_date < %(end_exclusive)s
  AND o.status = ANY(%(statuses)s)
  AND (%(currency)s IS NULL OR o.currency = %(currency)s)
GROUP BY 1, 2
ORDER BY 1, 2
"""
