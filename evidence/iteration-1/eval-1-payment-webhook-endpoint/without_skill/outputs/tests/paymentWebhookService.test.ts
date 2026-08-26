import { PaymentWebhookService } from '../src/services/paymentWebhookService';
import { InMemoryOrderRepository } from '../src/repositories/orderRepository';
import { InMemoryProcessedEventStore } from '../src/repositories/processedEventStore';
import { paymentWebhookEventSchema } from '../src/types/webhook';
import { OrderConflictError, OrderNotFoundError } from '../src/utils/errors';
import type { EmailService } from '../src/services/emailService';
import { makeEventPayload, makeOrder, silentLogger } from './helpers';

function buildService(orderOverrides = {}) {
  const orders = new InMemoryOrderRepository([makeOrder(orderOverrides)]);
  const processedEvents = new InMemoryProcessedEventStore();
  const email: jest.Mocked<EmailService> = { sendOrderConfirmation: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentWebhookService({
    orders,
    processedEvents,
    email,
    logger: silentLogger,
    now: () => new Date('2026-08-24T10:00:05.000Z'),
  });
  return { service, orders, processedEvents, email };
}

const event = (overrides = {}) => paymentWebhookEventSchema.parse(makeEventPayload(overrides));

describe('PaymentWebhookService', () => {
  it('marks the order paid and sends one confirmation email', async () => {
    const { service, orders, email } = buildService();

    const result = await service.handleEvent(event());

    expect(result).toEqual({ outcome: 'processed', orderId: 'ord_1', emailSent: true });
    const stored = await orders.findById('ord_1');
    expect(stored?.status).toBe('paid');
    expect(stored?.paymentReference).toBe('pay_1');
    expect(stored?.paidAt).toEqual(new Date('2026-08-24T10:00:05.000Z'));
    expect(email.sendOrderConfirmation).toHaveBeenCalledTimes(1);
    expect(email.sendOrderConfirmation).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }));
  });

  it('ignores a duplicate delivery of the same event id', async () => {
    const { service, email } = buildService();

    await service.handleEvent(event());
    const second = await service.handleEvent(event());

    expect(second.outcome).toBe('duplicate');
    expect(email.sendOrderConfirmation).toHaveBeenCalledTimes(1);
  });

  it('does not re-send the email when a different event finds the order already paid', async () => {
    const { service, email } = buildService();

    await service.handleEvent(event({ id: 'evt_1' }));
    const second = await service.handleEvent(event({ id: 'evt_2', paymentId: 'pay_2' }));

    expect(second.outcome).toBe('already_paid');
    expect(email.sendOrderConfirmation).toHaveBeenCalledTimes(1);
  });

  it('ignores event types other than payment.succeeded', async () => {
    const { service, orders, email } = buildService();

    const result = await service.handleEvent(event({ type: 'payment.failed' }));

    expect(result.outcome).toBe('ignored');
    expect((await orders.findById('ord_1'))?.status).toBe('pending');
    expect(email.sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it('rejects an unknown order', async () => {
    const { service } = buildService();
    await expect(service.handleEvent(event({ orderId: 'ord_missing' }))).rejects.toBeInstanceOf(OrderNotFoundError);
  });

  it('rejects an amount mismatch without touching the order', async () => {
    const { service, orders, email } = buildService();

    await expect(service.handleEvent(event({ amount: 1 }))).rejects.toBeInstanceOf(OrderConflictError);
    expect((await orders.findById('ord_1'))?.status).toBe('pending');
    expect(email.sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it('rejects a currency mismatch', async () => {
    const { service } = buildService();
    await expect(service.handleEvent(event({ currency: 'USD' }))).rejects.toBeInstanceOf(OrderConflictError);
  });

  it('refuses to pay a cancelled order', async () => {
    const { service } = buildService({ status: 'cancelled' as const });
    await expect(service.handleEvent(event())).rejects.toBeInstanceOf(OrderConflictError);
  });

  it('releases the event claim when processing fails so the gateway can retry', async () => {
    const { service, processedEvents } = buildService();

    await expect(service.handleEvent(event({ amount: 1 }))).rejects.toBeInstanceOf(OrderConflictError);
    // A retry of the same event id must be accepted, not treated as duplicate.
    await expect(processedEvents.claim('evt_1')).resolves.toBe(true);
  });

  it('keeps the order paid when the confirmation email fails', async () => {
    const { service, orders, email } = buildService();
    email.sendOrderConfirmation.mockRejectedValueOnce(new Error('smtp down'));

    const result = await service.handleEvent(event());

    expect(result).toEqual({ outcome: 'processed', orderId: 'ord_1', emailSent: false });
    expect((await orders.findById('ord_1'))?.status).toBe('paid');
  });
});
