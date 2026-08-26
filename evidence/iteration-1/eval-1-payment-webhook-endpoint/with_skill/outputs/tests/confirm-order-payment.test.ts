import { beforeEach, describe, expect, it } from 'vitest';
import { ConfirmOrderPayment } from '../src/application/confirm-order-payment.js';
import type { PaymentNotification } from '../src/webhook/schema.js';
import {
  InMemoryOrderRepository,
  RecordingEmailSender,
  pendingOrder,
  silentLogger,
} from './support/test-doubles.js';

const PAID_AT = new Date('2026-08-24T10:00:00.000Z');

function notification(overrides: Partial<PaymentNotification> = {}): PaymentNotification {
  return {
    eventId: 'evt_1',
    type: 'payment.succeeded',
    occurredAt: PAID_AT,
    paymentId: 'pay_1',
    orderId: 'ord_1001',
    amountMinorUnits: 125_000,
    currency: 'THB',
    ...overrides,
  };
}

describe('ConfirmOrderPayment', () => {
  let orders: InMemoryOrderRepository;
  let email: RecordingEmailSender;
  let useCase: ConfirmOrderPayment;

  beforeEach(() => {
    orders = new InMemoryOrderRepository([pendingOrder()]);
    email = new RecordingEmailSender();
    useCase = new ConfirmOrderPayment({
      orders,
      email,
      logger: silentLogger(),
      now: () => PAID_AT,
    });
  });

  it('marks the order paid and emails the customer', async () => {
    const outcome = await useCase.execute(notification());

    expect(outcome).toEqual({ status: 'processed', orderId: 'ord_1001', emailDelivered: true });
    expect(orders.get('ord_1001')).toMatchObject({ status: 'paid', paymentId: 'pay_1' });
    expect(email.sent).toEqual([
      {
        to: 'customer@example.com',
        orderId: 'ord_1001',
        amountMinorUnits: 125_000,
        currency: 'THB',
        paidAt: PAID_AT,
      },
    ]);
    expect(orders.emailSentAt.get('ord_1001')).toEqual(PAID_AT);
  });

  it('sends to the address on the order, not one supplied in the payload', async () => {
    await useCase.execute(notification());
    expect(email.sent[0]?.to).toBe('customer@example.com');
  });

  it('ignores a redelivery of the same event and does not email twice', async () => {
    await useCase.execute(notification());
    const second = await useCase.execute(notification());

    expect(second).toEqual({ status: 'duplicate', eventId: 'evt_1' });
    expect(email.sent).toHaveLength(1);
  });

  it('treats a new event id for an already applied payment as already applied', async () => {
    await useCase.execute(notification());
    const second = await useCase.execute(notification({ eventId: 'evt_2' }));

    expect(second).toEqual({ status: 'already_applied', orderId: 'ord_1001' });
    expect(email.sent).toHaveLength(1);
  });

  it('does not mark an order paid when the amount does not match', async () => {
    const outcome = await useCase.execute(notification({ amountMinorUnits: 1 }));

    expect(outcome).toEqual({ status: 'ignored', orderId: 'ord_1001', reason: 'amount_mismatch' });
    expect(orders.get('ord_1001')?.status).toBe('pending');
    expect(email.sent).toHaveLength(0);
  });

  it('does not resurrect a cancelled order', async () => {
    orders = new InMemoryOrderRepository([pendingOrder({ status: 'cancelled' })]);
    useCase = new ConfirmOrderPayment({ orders, email, logger: silentLogger(), now: () => PAID_AT });

    const outcome = await useCase.execute(notification());

    expect(outcome).toEqual({ status: 'ignored', orderId: 'ord_1001', reason: 'order_not_payable' });
    expect(orders.get('ord_1001')?.status).toBe('cancelled');
    expect(email.sent).toHaveLength(0);
  });

  it('reports an unknown order instead of throwing', async () => {
    const outcome = await useCase.execute(notification({ orderId: 'ord_missing' }));
    expect(outcome).toEqual({ status: 'ignored', orderId: 'ord_missing', reason: 'order_not_found' });
    expect(email.sent).toHaveLength(0);
  });

  it('keeps the payment recorded when the confirmation email fails', async () => {
    email.failWith = new Error('smtp unavailable');

    const outcome = await useCase.execute(notification());

    expect(outcome).toEqual({ status: 'processed', orderId: 'ord_1001', emailDelivered: false });
    expect(orders.get('ord_1001')?.status).toBe('paid');
    // Left unset so the retry sweep picks the order up.
    expect(orders.emailSentAt.has('ord_1001')).toBe(false);
  });

  it('propagates a database failure so the gateway redelivers, leaving no event claimed', async () => {
    orders.failNextTransactionWith = new Error('connection terminated');

    await expect(useCase.execute(notification())).rejects.toThrow('connection terminated');
    expect(orders.hasEvent('evt_1')).toBe(false);
    expect(orders.get('ord_1001')?.status).toBe('pending');

    // The redelivery then succeeds normally.
    await expect(useCase.execute(notification())).resolves.toMatchObject({ status: 'processed' });
  });

  it('applies only one payment when two deliveries race', async () => {
    const [first, second] = await Promise.all([
      useCase.execute(notification()),
      useCase.execute(notification({ eventId: 'evt_2' })),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(['already_applied', 'processed']);
    expect(email.sent).toHaveLength(1);
    expect(orders.get('ord_1001')).toMatchObject({ status: 'paid', paymentId: 'pay_1' });
  });
});
