import { normalizeCurrency } from './money.js';

export const ORDER_STATUSES = ['pending', 'paid', 'cancelled', 'expired'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface Order {
  readonly id: string;
  readonly customerEmail: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly status: OrderStatus;
  /** Set once a payment has been applied; used to tell a redelivery apart from a second charge. */
  readonly paymentId: string | null;
}

export interface PaymentAttempt {
  readonly paymentId: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
}

export type PaymentRejectionReason =
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'order_not_payable'
  | 'conflicting_payment';

export type PaymentDecision =
  /** Transition the order to paid. */
  | { readonly kind: 'accept' }
  /** This exact payment was already applied — a redelivery, not a new charge. */
  | { readonly kind: 'already_applied' }
  /** Do not touch the order; a human has to look at it. */
  | { readonly kind: 'reject'; readonly reason: PaymentRejectionReason };

/**
 * The single place that decides whether a gateway notification may flip an
 * order to paid. Pure on purpose: this is the rule that costs real money when
 * it is wrong, so it must be testable without a database.
 *
 * The amount and currency are re-checked against the order stored server-side
 * rather than trusted from the payload — a signed-but-wrong amount (partial
 * payment, gateway mis-configuration, replay of a cheap order's payment) must
 * never mark an expensive order as paid.
 */
export function decidePayment(order: Order, attempt: PaymentAttempt): PaymentDecision {
  if (order.status === 'paid') {
    return order.paymentId === attempt.paymentId
      ? { kind: 'already_applied' }
      : { kind: 'reject', reason: 'conflicting_payment' };
  }

  if (order.status !== 'pending') {
    return { kind: 'reject', reason: 'order_not_payable' };
  }

  if (normalizeCurrency(order.currency) !== normalizeCurrency(attempt.currency)) {
    return { kind: 'reject', reason: 'currency_mismatch' };
  }

  if (order.amountMinorUnits !== attempt.amountMinorUnits) {
    return { kind: 'reject', reason: 'amount_mismatch' };
  }

  return { kind: 'accept' };
}
