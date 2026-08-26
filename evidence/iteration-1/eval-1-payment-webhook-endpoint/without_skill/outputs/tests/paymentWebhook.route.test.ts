import request from 'supertest';
import { createApp } from '../src/app';
import { PaymentWebhookService } from '../src/services/paymentWebhookService';
import { InMemoryOrderRepository } from '../src/repositories/orderRepository';
import { InMemoryProcessedEventStore } from '../src/repositories/processedEventStore';
import type { EmailService } from '../src/services/emailService';
import { FIXED_NOW_MS, TEST_SECRET, makeEventPayload, makeOrder, signBody, silentLogger } from './helpers';

const SIGNATURE_HEADER = 'x-payment-signature';

function buildApp() {
  const orders = new InMemoryOrderRepository([makeOrder()]);
  const email: jest.Mocked<EmailService> = { sendOrderConfirmation: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentWebhookService({
    orders,
    processedEvents: new InMemoryProcessedEventStore(),
    email,
    logger: silentLogger,
    now: () => new Date(FIXED_NOW_MS),
  });
  const app = createApp({
    service,
    logger: silentLogger,
    webhookSecret: TEST_SECRET,
    webhookToleranceSeconds: 300,
    now: () => FIXED_NOW_MS,
  });
  return { app, orders, email };
}

function post(app: ReturnType<typeof buildApp>['app'], body: string, signature?: string) {
  const req = request(app).post('/webhooks/payments').set('content-type', 'application/json');
  if (signature !== undefined) req.set(SIGNATURE_HEADER, signature);
  return req.send(body);
}

describe('POST /webhooks/payments', () => {
  it('accepts a correctly signed payment.succeeded event', async () => {
    const { app, orders, email } = buildApp();
    const body = JSON.stringify(makeEventPayload());

    const res = await post(app, body, signBody(body));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, outcome: 'processed' });
    expect((await orders.findById('ord_1'))?.status).toBe('paid');
    expect(email.sendOrderConfirmation).toHaveBeenCalledTimes(1);
  });

  it('returns 401 and does not touch the order when the signature is missing', async () => {
    const { app, orders, email } = buildApp();
    const body = JSON.stringify(makeEventPayload());

    const res = await post(app, body);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_signature');
    expect((await orders.findById('ord_1'))?.status).toBe('pending');
    expect(email.sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it('returns 401 when the body was tampered with after signing', async () => {
    const { app } = buildApp();
    const signature = signBody(JSON.stringify(makeEventPayload()));
    const tampered = JSON.stringify(makeEventPayload({ amount: 1 }));

    const res = await post(app, tampered, signature);

    expect(res.status).toBe(401);
  });

  it('returns 400 for a signed but malformed payload', async () => {
    const { app } = buildApp();
    const body = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded' });

    const res = await post(app, body, signBody(body));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_payload');
  });

  it('returns 400 for signed non-JSON bytes', async () => {
    const { app } = buildApp();
    const body = 'not json at all';

    const res = await post(app, body, signBody(body));

    expect(res.status).toBe(400);
  });

  it('returns 404 when the order does not exist', async () => {
    const { app } = buildApp();
    const body = JSON.stringify(makeEventPayload({ orderId: 'ord_missing' }));

    const res = await post(app, body, signBody(body));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('order_not_found');
  });

  it('returns 409 on an amount mismatch', async () => {
    const { app } = buildApp();
    const body = JSON.stringify(makeEventPayload({ amount: 999 }));

    const res = await post(app, body, signBody(body));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('order_conflict');
  });

  it('acknowledges a replayed delivery with 200 without re-sending email', async () => {
    const { app, email } = buildApp();
    const body = JSON.stringify(makeEventPayload());
    const signature = signBody(body);

    await post(app, body, signature);
    const res = await post(app, body, signature);

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('duplicate');
    expect(email.sendOrderConfirmation).toHaveBeenCalledTimes(1);
  });

  it('exposes a health endpoint', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
