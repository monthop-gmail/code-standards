import type { Logger } from '../utils/logger';
import type { OrderRepository } from '../repositories/orderRepository';
import type { ProcessedEventStore } from '../repositories/processedEventStore';
import type { EmailService } from './emailService';
import { OrderConflictError, OrderNotFoundError } from '../utils/errors';
import { PAYMENT_SUCCEEDED_EVENT, type PaymentWebhookEvent } from '../types/webhook';

export type HandleOutcome = 'processed' | 'duplicate' | 'ignored' | 'already_paid';

export interface HandleResult {
  readonly outcome: HandleOutcome;
  readonly orderId: string | null;
  readonly emailSent: boolean;
}

export interface PaymentWebhookServiceDeps {
  readonly orders: OrderRepository;
  readonly processedEvents: ProcessedEventStore;
  readonly email: EmailService;
  readonly logger: Logger;
  readonly now?: () => Date;
}

export class PaymentWebhookService {
  constructor(private readonly deps: PaymentWebhookServiceDeps) {}

  async handleEvent(event: PaymentWebhookEvent): Promise<HandleResult> {
    const { logger } = this.deps;

    // We acknowledge every event we understand; only act on successful payments.
    if (event.type !== PAYMENT_SUCCEEDED_EVENT) {
      logger.info({ eventId: event.id, type: event.type }, 'Ignoring unhandled webhook event type');
      return { outcome: 'ignored', orderId: null, emailSent: false };
    }

    const claimed = await this.deps.processedEvents.claim(event.id);
    if (!claimed) {
      logger.info({ eventId: event.id }, 'Duplicate webhook delivery ignored');
      return { outcome: 'duplicate', orderId: event.data.orderId, emailSent: false };
    }

    try {
      return await this.process(event);
    } catch (error) {
      // The order was not updated, so let the gateway retry this event id.
      await this.deps.processedEvents.release(event.id);
      throw error;
    }
  }

  private async process(event: PaymentWebhookEvent): Promise<HandleResult> {
    const { logger } = this.deps;
    const { orderId, paymentId, amount, currency } = event.data;

    const order = await this.deps.orders.findById(orderId);
    if (!order) throw new OrderNotFoundError(orderId);

    // Never trust the gateway blindly: a mismatch means the event does not
    // belong to this order, or the cart changed after checkout.
    if (order.totalAmount !== amount || order.currency.toUpperCase() !== currency.toUpperCase()) {
      throw new OrderConflictError(
        `Payment amount mismatch for order ${orderId}: expected ${order.totalAmount} ${order.currency}, got ${amount} ${currency}`,
      );
    }

    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw new OrderConflictError(`Order ${orderId} is ${order.status} and cannot be marked paid`);
    }

    const { order: updated, alreadyPaid } = await this.deps.orders.markAsPaid({
      orderId,
      paymentReference: paymentId,
      paidAt: this.deps.now?.() ?? new Date(),
    });

    if (alreadyPaid) {
      logger.info({ eventId: event.id, orderId }, 'Order already paid; skipping confirmation email');
      return { outcome: 'already_paid', orderId, emailSent: false };
    }

    logger.info({ eventId: event.id, orderId, paymentId }, 'Order marked as paid');

    // The payment is already recorded. A mail failure must not make the
    // gateway retry (which would double-charge our own side effects), so we
    // swallow it here and rely on logs/alerting — in production, enqueue a job.
    let emailSent = false;
    try {
      await this.deps.email.sendOrderConfirmation(updated);
      emailSent = true;
      logger.info({ orderId }, 'Confirmation email sent');
    } catch (error) {
      logger.error({ err: error, orderId }, 'Failed to send confirmation email; order remains paid');
    }

    return { outcome: 'processed', orderId, emailSent };
  }
}
