-- Reference schema assumed by monthly_sales/queries.py.
-- Adapt queries.py if your production schema differs.

CREATE TABLE IF NOT EXISTS orders (
    id           bigserial PRIMARY KEY,
    order_date   timestamptz    NOT NULL,
    status       text           NOT NULL,
    customer_id  bigint         NOT NULL,
    currency     char(3)        NOT NULL,
    total_amount numeric(12, 2) NOT NULL CHECK (total_amount >= 0)
);

-- Supports the range scan + grouping used by the report.
CREATE INDEX IF NOT EXISTS orders_order_date_status_idx
    ON orders (order_date, status);

-- A read-only role is enough for this job; grant nothing more.
-- CREATE ROLE report_reader LOGIN PASSWORD '...';
-- GRANT CONNECT ON DATABASE sales TO report_reader;
-- GRANT USAGE ON SCHEMA public TO report_reader;
-- GRANT SELECT ON orders TO report_reader;
