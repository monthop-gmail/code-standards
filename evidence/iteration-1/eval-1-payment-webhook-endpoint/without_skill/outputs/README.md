# Payment Webhook Service

Express + TypeScript endpoint that receives payment gateway webhooks, marks the
order as `paid`, and sends a confirmation email.

## Endpoint

```
POST /webhooks/payments
Content-Type: application/json
X-Payment-Signature: t=<unix-seconds>,v1=<hex hmac-sha256>
```

Body:

```json
{
  "id": "evt_123",
  "type": "payment.succeeded",
  "createdAt": "2026-08-24T10:00:00.000Z",
  "data": {
    "paymentId": "pay_123",
    "orderId": "ord_123",
    "amount": 25000,
    "currency": "THB",
    "status": "succeeded"
  }
}
```

`amount` is in minor units (satang/cents) and must equal the order total.

### Responses

| Status | Meaning | Gateway should retry |
| --- | --- | --- |
| 200 `{received:true,outcome:"processed"}` | Order marked paid, email sent | no |
| 200 `outcome:"duplicate"` / `"already_paid"` | Replay, no side effects repeated | no |
| 200 `outcome:"ignored"` | Event type we do not act on | no |
| 400 `invalid_payload` | Body is not JSON / fails schema | no |
| 401 `invalid_signature` | Bad, missing, or stale signature | no |
| 404 `order_not_found` | Unknown order id | yes |
| 409 `order_conflict` | Amount/currency mismatch, or order cancelled/refunded | no |
| 500 `internal_error` | Unexpected failure | yes |

## Design notes

- **Signature verification happens on raw bytes.** The route is mounted with
  `express.raw()`, so the HMAC is computed over exactly what the gateway sent.
  Mounting a global `express.json()` in front of it would break verification.
- **Constant-time comparison + timestamp tolerance** (`timingSafeEqual`, default
  300s) block signature-forgery timing attacks and replay of old bodies.
- **Idempotency has two layers**: an event-id claim (`ProcessedEventStore`) and a
  conditional `markAsPaid` that reports `alreadyPaid`. Either one alone would
  leak a duplicate email in some ordering; together the email is sent at most
  once per order.
- **Email failure does not fail the webhook.** Once the order is paid, returning
  a 5xx would make the gateway retry a payment that already succeeded. The error
  is logged instead; in production, enqueue a retryable job here.
- **The amount is verified against the order** before anything is marked paid —
  a webhook payload is attacker-influenced input, not a source of truth.
- **Persistence is behind interfaces.** `InMemoryOrderRepository` and
  `InMemoryProcessedEventStore` are reference implementations; swap them in
  `src/server.ts` for DB-backed ones. `markAsPaid` must be a single conditional
  UPDATE, and `claim` a single `INSERT ... ON CONFLICT DO NOTHING`.

## Layout

```
src/
  app.ts                       Express wiring
  server.ts                    Composition root + graceful shutdown
  config/env.ts                Zod-validated env, fails fast at boot
  middleware/                  request id, signature verification, error handler
  routes/paymentWebhook.ts     Route + payload parsing
  services/
    signature.ts               HMAC compute/verify
    paymentWebhookService.ts   Business logic
    emailService.ts            SMTP + template rendering
  repositories/                OrderRepository, ProcessedEventStore
  types/                       Order and webhook contracts
tests/                         Unit + supertest integration tests
```

## Getting started

```bash
npm install
cp .env.example .env   # fill in the secret + SMTP credentials
npm run dev
npm test
```
