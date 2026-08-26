# payment-webhook-service

Endpoint รับ webhook จาก payment gateway → อัปเดตสถานะ order เป็น `paid` → ส่งอีเมลยืนยัน

```
POST /api/v1/webhooks/payments
GET  /healthz
```

## ติดตั้งและรัน

```bash
npm install
cp .env.example .env          # เติมค่าจริง
psql "$DATABASE_URL" -f migrations/001_orders_and_payment_webhook_events.sql
npm run dev                   # dev
npm run build && npm start    # production (start อ่าน env จาก process จริง)
npm test                      # vitest
npm run typecheck
```

## Environment variables

| ตัวแปร | จำเป็น | ค่า default | หมายเหตุ |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | — | Postgres connection string |
| `PAYMENT_WEBHOOK_SECRET` | ✅ | — | secret ที่ gateway ใช้เซ็น (≥ 16 ตัวอักษร) |
| `SMTP_URL` | ✅ | — | เช่น `smtps://user:pass@smtp.host:465` |
| `MAIL_FROM` | ✅ | — | ผู้ส่งของอีเมลยืนยัน |
| `PORT` | — | `3000` | |
| `NODE_ENV` | — | `development` | |
| `LOG_LEVEL` | — | `info` | `debug` / `info` / `warn` / `error` |
| `PAYMENT_WEBHOOK_TOLERANCE_SECONDS` | — | `300` | ช่วง timestamp ที่ยอมรับบน signature |

process จะไม่ start ถ้า env ที่จำเป็นหายหรือผิดรูปแบบ

## รูปแบบ request ที่รองรับ

Header: `X-Payment-Signature: t=<unix seconds>,v1=<hex hmac-sha256>`
โดย signed payload คือ `<t>.<raw body>` (สูตรเดียวกับ Stripe/Omise)

```json
{
  "id": "evt_01J9...",
  "type": "payment.succeeded",
  "data": {
    "order_id": "8f1b9b6e-0f3e-4a4e-9a4a-2c9f0f2f8c11",
    "payment_reference": "chrg_test_123",
    "amount": 129900,
    "currency": "THB"
  }
}
```

`amount` เป็น **หน่วยย่อย (สตางค์)** เสมอ

## Status code ที่ตอบกลับ gateway

| สถานการณ์ | status | เหตุผล |
| --- | --- | --- |
| อัปเดตสำเร็จ / event ซ้ำ / order จ่ายแล้ว | `200` | งานจบแล้ว ไม่ต้อง retry |
| `type` ไม่ใช่ `payment.succeeded` | `200` | ตั้งใจไม่สนใจ |
| signature ผิด/หาย/หมดอายุ | `401` | |
| body ไม่ใช่ JSON หรือผิด schema | `400` | |
| ไม่พบ order | `404` | ให้ gateway retry เผื่อ webhook มาถึงก่อน order commit |
| ยอดเงินไม่ตรงกับ order | `409` | อาจเป็น payload ปลอม — ไม่อัปเดตเป็น paid |

## การตัดสินใจที่สำคัญ

- **verify signature จาก raw bytes ก่อน parse JSON** — `express.raw()` ถูกใส่เฉพาะ route นี้ ไม่มี `express.json()` ระดับ app
- **idempotency ผูกกับ transaction เดียวกับการอัปเดต order** — insert `payment_webhook_events` แล้วอัปเดต order ใน transaction เดียว ถ้า rollback แถว event หายไปด้วย retry จึงยังทำงานได้ (ถ้าแยก commit จะกลายเป็น "event ถูกมาร์คว่าทำแล้ว แต่ order ไม่เคยถูกอัปเดต")
- **ไม่เชื่อยอดเงินจาก payload** — เทียบกับยอดใน DB ก่อนเสมอ
- **`UPDATE ... WHERE status = 'pending'`** — กันเขียนทับ order ที่ถูกยกเลิก/คืนเงิน และปลอดภัยเมื่อยิงซ้ำ
- **อีเมลส่งหลัง commit และล้มได้** — order เป็น paid ไปแล้ว การตอบ 5xx กลับไปมีแต่ทำให้ gateway retry ซึ่งจะถูกกันด้วย idempotency อยู่ดี แถวที่ `status='paid' AND confirmation_email_sent_at IS NULL` คือคิวให้ job ตามส่งทีหลัง (มี partial index รองรับแล้ว)

## ยังไม่ได้ทำ (ตั้งใจ)

- **Job ตามส่งอีเมลที่ค้าง** — schema + index พร้อมแล้ว แต่ตัว worker ยังไม่มี
- **Rate limit / IP allowlist** ที่ชั้น edge — signature ป้องกันของปลอมได้ แต่ไม่กันคนยิงถล่ม
- **ESLint + Prettier** — ยังไม่ได้ตั้ง config
- ยังไม่มี integration test ที่ยิง HTTP จริง (ต้องใช้ `supertest` + Postgres ในเทสต์)
