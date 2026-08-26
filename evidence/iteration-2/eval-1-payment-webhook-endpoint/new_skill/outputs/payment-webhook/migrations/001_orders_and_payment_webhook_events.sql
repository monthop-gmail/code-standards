-- 001: ตาราง orders + ตารางกัน webhook ซ้ำ
-- เงินเก็บเป็น "หน่วยย่อย" (สตางค์) แบบ BIGINT เสมอ — ห้ามใช้ float กับจำนวนเงิน

BEGIN;

CREATE TABLE IF NOT EXISTS orders (
    id                          UUID PRIMARY KEY,
    customer_email              TEXT        NOT NULL,
    customer_name               TEXT        NOT NULL,
    amount_minor_units          BIGINT      NOT NULL CHECK (amount_minor_units > 0),
    currency                    CHAR(3)     NOT NULL CHECK (currency = UPPER(currency)),
    status                      TEXT        NOT NULL DEFAULT 'pending'
                                            CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded', 'failed')),
    payment_reference           TEXT,
    paid_at                     TIMESTAMPTZ,
    confirmation_email_sent_at  TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ใช้โดย job ที่ตามเก็บอีเมลยืนยันที่ส่งไม่สำเร็จ (partial index เล็กและตรงกับ query จริง)
CREATE INDEX IF NOT EXISTS orders_pending_confirmation_email_idx
    ON orders (paid_at)
    WHERE status = 'paid' AND confirmation_email_sent_at IS NULL;

-- event_id เป็น PK คือหัวใจของ idempotency: gateway ส่งซ้ำได้เสมอ
-- แถวนี้ถูก insert ใน transaction เดียวกับการอัปเดต order
-- ถ้า transaction rollback แถวนี้จะหายไปด้วย -> retry ของ gateway ยังทำงานได้
CREATE TABLE IF NOT EXISTS payment_webhook_events (
    event_id     TEXT        PRIMARY KEY,
    event_type   TEXT        NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
