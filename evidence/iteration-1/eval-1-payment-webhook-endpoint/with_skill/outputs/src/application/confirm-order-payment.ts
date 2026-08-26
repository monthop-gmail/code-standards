import { decidePayment, type Order, type PaymentRejectionReason } from '../domain/order.js';
import type { PaymentNotification } from '../webhook/schema.js';
import type { Logger } from '../logger.js';
import type { EmailSender, OrderRepository } from './ports.js';

export type IgnoreReason = PaymentRejectionReason | 'order_not_found';

export type ConfirmationOutcome =
  /** The order moved pending -> paid during this call. */
  | { readonly status: 'processed'; readonly orderId: string; readonly emailDelivered: boolean }
  /** The gateway sent an event id we have already stored. */
  | { readonly status: 'duplicate'; readonly eventId: string }
  /** A different event id for a payment already applied to this order. */
  | { readonly status: 'already_applied'; readonly orderId: string }
  /** Nothing was changed and redelivering will not help — needs a human. */
  | { readonly status: 'ignored'; readonly orderId: string; readonly reason: IgnoreReason };

type TransactionResult =
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'ignored'; readonly reason: IgnoreReason }
  | { readonly kind: 'already_applied' }
  | { readonly kind: 'paid'; readonly order: Order; readonly paidAt: Date };

export interface ConfirmOrderPaymentDependencies {
  readonly orders: OrderRepository;
  readonly email: EmailSender;
  readonly logger: Logger;
  /** Injected so tests do not depend on the wall clock. */
  readonly now?: () => Date;
}

/**
 * Applies a verified "payment succeeded" notification to an order and sends the
 * confirmation email.
 *
 * Two rules shape the flow:
 *  1. The state change and the idempotency claim share one transaction, so a
 *     crash mid-way leaves nothing half-applied and the gateway's retry is a
 *     clean re-run.
 *  2. The email is sent *after* the commit and its failure never fails the
 *     call. A failed mail must not roll back money that the gateway has
 *     already captured, nor trigger an endless redelivery loop.
 */
export class ConfirmOrderPayment {
  private readonly orders: OrderRepository;
  private readonly email: EmailSender;
  private readonly logger: Logger;
  private readonly now: () => Date;

  constructor(dependencies: ConfirmOrderPaymentDependencies) {
    this.orders = dependencies.orders;
    this.email = dependencies.email;
    this.logger = dependencies.logger;
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(notification: PaymentNotification): Promise<ConfirmationOutcome> {
    const result = await this.applyInTransaction(notification);

    switch (result.kind) {
      case 'duplicate':
        this.logger.info(
          { eventId: notification.eventId, orderId: notification.orderId },
          'duplicate webhook delivery ignored',
        );
        return { status: 'duplicate', eventId: notification.eventId };

      case 'already_applied':
        this.logger.info(
          { eventId: notification.eventId, orderId: notification.orderId },
          'payment already applied to order',
        );
        return { status: 'already_applied', orderId: notification.orderId };

      case 'ignored':
        this.logIgnored(notification, result.reason);
        return { status: 'ignored', orderId: notification.orderId, reason: result.reason };

      case 'paid': {
        const emailDelivered = await this.sendConfirmation(result.order, result.paidAt);
        this.logger.info(
          { eventId: notification.eventId, orderId: result.order.id, emailDelivered },
          'order marked as paid',
        );
        return { status: 'processed', orderId: result.order.id, emailDelivered };
      }
    }
  }

  private async applyInTransaction(notification: PaymentNotification): Promise<TransactionResult> {
    return this.orders.runInTransaction(async (tx) => {
      const claimed = await tx.claimEvent({
        eventId: notification.eventId,
        paymentId: notification.paymentId,
        orderId: notification.orderId,
        receivedAt: this.now(),
      });
      if (!claimed) {
        return { kind: 'duplicate' };
      }

      const order = await tx.findOrderForUpdate(notification.orderId);
      if (!order) {
        return { kind: 'ignored', reason: 'order_not_found' };
      }

      const decision = decidePayment(order, {
        paymentId: notification.paymentId,
        amountMinorUnits: notification.amountMinorUnits,
        currency: notification.currency,
      });

      if (decision.kind === 'reject') {
        return { kind: 'ignored', reason: decision.reason };
      }
      if (decision.kind === 'already_applied') {
        return { kind: 'already_applied' };
      }

      const paidAt = this.now();
      await tx.markPaid(order.id, notification.paymentId, paidAt);
      return {
        kind: 'paid',
        order: { ...order, status: 'paid', paymentId: notification.paymentId },
        paidAt,
      };
    });
  }

  /**
   * The recipient comes from the order row, never from the webhook payload:
   * a signed payload with an attacker-supplied address would otherwise turn
   * this endpoint into a way to read someone else's order details.
   */
  private async sendConfirmation(order: Order, paidAt: Date): Promise<boolean> {
    try {
      await this.email.sendOrderPaidConfirmation({
        to: order.customerEmail,
        orderId: order.id,
        amountMinorUnits: order.amountMinorUnits,
        currency: order.currency,
        paidAt,
      });
      await this.orders.markConfirmationEmailSent(order.id, this.now());
      return true;
    } catch (cause) {
      // Deliberately swallowed *and reported*: the payment stands either way.
      // Orders left with confirmation_email_sent_at IS NULL are the retry queue.
      this.logger.error(
        { orderId: order.id, error: describeError(cause) },
        'confirmation email failed; order stays paid and awaits the email retry sweep',
      );
      return false;
    }
  }

  private logIgnored(notification: PaymentNotification, reason: IgnoreReason): void {
    const context = {
      eventId: notification.eventId,
      orderId: notification.orderId,
      paymentId: notification.paymentId,
      reason,
      notifiedAmountMinorUnits: notification.amountMinorUnits,
      notifiedCurrency: notification.currency,
    };
    // amount/currency/conflict mismatches mean money moved for something we did
    // not agree to — that is an alert, not an info line.
    if (reason === 'order_not_found' || reason === 'order_not_payable') {
      this.logger.warn(context, 'payment notification ignored');
    } else {
      this.logger.error(context, 'payment notification rejected — manual reconciliation required');
    }
  }
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}
