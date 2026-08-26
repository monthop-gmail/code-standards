# payment-webhook-service

Receives `payment.succeeded` webhooks from the payment gateway, marks the matching
order as **paid**, and emails the customer a confirmation.

Node 20+ / TypeScript / Express 5 / PostgreSQL.

## Setup

```bash
npm install
cp .env.example .env          # fill in the real values
npm run migrate               # creates orders + payment_events
npm run dev                   # or: npm run build && npm start
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `PAYMENT_WEBHOOK_SECRET` | Signing secret from the gateway dashboard (min 32 chars) |
| `PAYMENT_WEBHOOK_TOLERANCE_SECONDS` | Replay window, default 300 |
| `SMTP_URL`, `MAIL_FROM` | Outgoing mail transport and sender |
| `MERCHANT_NAME`, `MERCHANT_SUPPORT_EMAIL` | Email branding |

The process refuses to start if any of these is missing or malformed.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/payments/webhook` | Gateway callback |
| `GET` | `/healthz` | Liveness (no dependencies touched) |
| `GET` | `/readyz` | Readiness (pings the database) |

### Expected delivery

```
POST /api/v1/payments/webhook
x-payment-signature: t=1756029600,v1=<hex hmac-sha256>
content-type: application/json

{
  "id": "evt_01H...",              // gateway event id — the idempotency key
  "type": "payment.succeeded",
  "created_at": "2026-08-24T10:00:00.000Z",
  "data": {
    "payment_id": "pay_01H...",
    "order_id": "ord_1001",
    "amount": 125000,              // minor units (satang)
    "currency": "THB"
  }
}
```

The signature is `HMAC-SHA256(secret, "<timestamp>.<raw body>")`, hex encoded.

### Response codes — and what they tell the gateway

| Code | When | Gateway should |
| --- | --- | --- |
| `200` | Applied, duplicate, or deliberately ignored (unknown event type, amount mismatch, non-payable order) | Stop retrying |
| `400` | Body is not JSON, or fails schema validation | Stop retrying — identical bytes will fail again |
| `401` | Signature missing, malformed, expired, or wrong | Stop retrying |
| `500` | Database or other transient failure | Retry |

Business rejections answer `200` on purpose: redelivery cannot fix an amount
mismatch. They are logged at `error` level with the order id, payment id and the
notified amount, which is the signal for manual reconciliation.

## Adapting to your gateway

Two files hold everything gateway-specific:

- `src/webhook/signature.ts` — header name, `t=`/`v1=` layout, signed-payload format
- `src/webhook/schema.ts` — field names and the `payment.succeeded` event name

The Stripe-style scheme implemented here matches Stripe, Omise and most
Thai gateways of that class. Check the vendor docs and adjust those two files;
nothing else knows about the gateway.

## Tests

```bash
npm test         # vitest
npm run typecheck
npm run lint
```

Covered: signature verification (tamper, replay, malformed header, non-ASCII
bodies), the payment decision rules, idempotency and concurrency in the use
case, email-failure isolation, HTTP status mapping, and email escaping.
