import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp, API_PREFIX } from '../src/http/app.js';
import { ConfirmOrderPayment } from '../src/application/confirm-order-payment.js';
import { buildSignatureHeader, SIGNATURE_HEADER } from '../src/webhook/signature.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import {
  InMemoryOrderRepository,
  RecordingEmailSender,
  pendingOrder,
  silentLogger,
} from './support/test-doubles.js';

const SECRET = 'test-secret-that-is-long-enough-000000';
const WEBHOOK_PATH = `${API_PREFIX}/payments/webhook`;

const config: AppConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://localhost:5432/test',
  PAYMENT_WEBHOOK_SECRET: SECRET,
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'orders@example.com',
  MERCHANT_SUPPORT_EMAIL: 'support@example.com',
});

function validEvent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'evt_1',
    type: 'payment.succeeded',
    created_at: '2026-08-24T10:00:00.000Z',
    data: {
      payment_id: 'pay_1',
      order_id: 'ord_1001',
      amount: 125_000,
      currency: 'THB',
    },
    ...overrides,
  });
}

function sign(body: string): string {
  return buildSignatureHeader(Buffer.from(body, 'utf8'), SECRET, Math.floor(Date.now() / 1000));
}

function post(app: Express, body: string, signature = sign(body)) {
  return request(app)
    .post(WEBHOOK_PATH)
    .set('content-type', 'application/json')
    .set(SIGNATURE_HEADER, signature)
    .send(body);
}

describe('POST /api/v1/payments/webhook', () => {
  let orders: InMemoryOrderRepository;
  let email: RecordingEmailSender;
  let app: Express;
  let readinessError: Error | null;

  beforeEach(() => {
    orders = new InMemoryOrderRepository([pendingOrder()]);
    email = new RecordingEmailSender();
    readinessError = null;
    app = createApp({
      config,
      logger: silentLogger(),
      confirmOrderPayment: new ConfirmOrderPayment({ orders, email, logger: silentLogger() }),
      checkReadiness: () => (readinessError ? Promise.reject(readinessError) : Promise.resolve()),
    });
  });

  it('accepts a signed payment.succeeded event and marks the order paid', async () => {
    const response = await post(app, validEvent());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'processed', orderId: 'ord_1001', emailDelivered: true });
    expect(orders.get('ord_1001')?.status).toBe('paid');
    expect(email.sent).toHaveLength(1);
  });

  it('answers 401 without a signature header and never touches the order', async () => {
    const body = validEvent();
    const response = await request(app)
      .post(WEBHOOK_PATH)
      .set('content-type', 'application/json')
      .send(body);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('invalid_signature');
    // The failure reason stays in the logs, out of the response.
    expect(JSON.stringify(response.body)).not.toContain('missing_header');
    expect(orders.get('ord_1001')?.status).toBe('pending');
  });

  it('answers 401 when the body was altered after signing', async () => {
    const signature = sign(validEvent());
    const tampered = validEvent({
      data: { payment_id: 'pay_1', order_id: 'ord_1001', amount: 1, currency: 'THB' },
    });

    const response = await post(app, tampered, signature);

    expect(response.status).toBe(401);
    expect(orders.get('ord_1001')?.status).toBe('pending');
  });

  it('answers 400 for a correctly signed but non-JSON body', async () => {
    const response = await post(app, 'not json at all');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_payload');
  });

  it('answers 400 with field-level detail for a schema violation', async () => {
    const body = JSON.stringify({
      id: 'evt_1',
      type: 'payment.succeeded',
      created_at: '2026-08-24T10:00:00.000Z',
      data: { payment_id: 'pay_1', order_id: 'ord_1001', amount: -5, currency: 'THBB' },
    });

    const response = await post(app, body);

    expect(response.status).toBe(400);
    expect(response.body.error.details.join(' ')).toContain('data.amount');
  });

  it('acknowledges event types it does not act on without retries', async () => {
    const response = await post(app, validEvent({ type: 'payment.pending' }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ignored', reason: 'unsupported_event_type' });
    expect(orders.get('ord_1001')?.status).toBe('pending');
  });

  it('acknowledges a redelivery with 200 so the gateway stops retrying', async () => {
    await post(app, validEvent());
    const response = await post(app, validEvent());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'duplicate', eventId: 'evt_1' });
    expect(email.sent).toHaveLength(1);
  });

  it('answers 200 for an amount mismatch and leaves the order untouched', async () => {
    const body = validEvent({
      data: { payment_id: 'pay_1', order_id: 'ord_1001', amount: 1, currency: 'THB' },
    });

    const response = await post(app, body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ignored', orderId: 'ord_1001', reason: 'amount_mismatch' });
    expect(orders.get('ord_1001')?.status).toBe('pending');
  });

  it('answers 500 without leaking internals when the database is down', async () => {
    orders.failNextTransactionWith = new Error('connection terminated unexpectedly');

    const response = await post(app, validEvent());

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('internal_error');
    expect(JSON.stringify(response.body)).not.toContain('connection terminated');
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });

  it('echoes a correlation id on every response', async () => {
    const response = await post(app, validEvent());
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('reports liveness and readiness separately', async () => {
    await expect(request(app).get('/healthz')).resolves.toMatchObject({ status: 200 });

    readinessError = new Error('pool exhausted');
    const notReady = await request(app).get('/readyz');
    expect(notReady.status).toBe(503);
  });

  it('answers 404 in the standard error shape for unknown paths', async () => {
    const response = await request(app).get('/api/v1/nope');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });
});
