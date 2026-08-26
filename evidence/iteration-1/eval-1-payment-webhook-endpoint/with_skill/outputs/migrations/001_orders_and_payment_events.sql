-- Orders and the webhook idempotency ledger.
-- Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_orders_and_payment_events.sql

BEGIN;

CREATE TABLE IF NOT EXISTS orders (
    id                          TEXT PRIMARY KEY,
    customer_email              TEXT        NOT NULL,
    -- Money is stored as integer minor units (satang/cents); never float.
    amount_minor_units          BIGINT      NOT NULL CHECK (amount_minor_units >= 0),
    currency                    CHAR(3)     NOT NULL CHECK (currency = upper(currency)),
    status                      TEXT        NOT NULL
        CHECK (status IN ('pending', 'paid', 'cancelled', 'expired')),
    payment_id                  TEXT,
    paid_at                     TIMESTAMPTZ,
    confirmation_email_sent_at  TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A paid order must carry the payment that paid it: this is what lets a
    -- redelivery be told apart from a second, conflicting charge.
    CONSTRAINT orders_paid_requires_payment
        CHECK (status <> 'paid' OR (payment_id IS NOT NULL AND paid_at IS NOT NULL))
);

-- One payment can settle at most one order.
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_id_key
    ON orders (payment_id) WHERE payment_id IS NOT NULL;

-- Drives the confirmation-email retry sweep.
CREATE INDEX IF NOT EXISTS orders_pending_confirmation_email_idx
    ON orders (paid_at) WHERE status = 'paid' AND confirmation_email_sent_at IS NULL;

-- Idempotency ledger: the primary key is the concurrency control that makes a
-- duplicate delivery a no-op, including when both arrive at the same instant.
CREATE TABLE IF NOT EXISTS payment_events (
    event_id    TEXT PRIMARY KEY,
    payment_id  TEXT        NOT NULL,
    order_id    TEXT        NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_events_order_id_idx ON payment_events (order_id);

COMMIT;
