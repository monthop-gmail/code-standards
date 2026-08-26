import type { Order } from '../types/order';

export interface MarkPaidInput {
  readonly orderId: string;
  readonly paymentReference: string;
  readonly paidAt: Date;
}

export interface MarkPaidResult {
  readonly order: Order;
  /** True when the order was already paid — the caller should skip side effects. */
  readonly alreadyPaid: boolean;
}

export interface OrderRepository {
  findById(orderId: string): Promise<Order | null>;
  /**
   * Must be atomic and idempotent. A real implementation should use a
   * conditional update, e.g.:
   *   UPDATE orders SET status='paid', paid_at=$2, payment_reference=$3
   *   WHERE id=$1 AND status='pending' RETURNING *;
   * and report alreadyPaid=true when zero rows were affected but the row is paid.
   */
  markAsPaid(input: MarkPaidInput): Promise<MarkPaidResult>;
}

/**
 * Reference in-memory implementation. Swap for a real DB-backed repository;
 * nothing outside this file needs to change.
 */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>();

  constructor(seed: readonly Order[] = []) {
    for (const order of seed) this.orders.set(order.id, order);
  }

  async findById(orderId: string): Promise<Order | null> {
    return this.orders.get(orderId) ?? null;
  }

  async markAsPaid({ orderId, paymentReference, paidAt }: MarkPaidInput): Promise<MarkPaidResult> {
    const existing = this.orders.get(orderId);
    if (!existing) throw new Error(`Order ${orderId} not found`);

    if (existing.status === 'paid') {
      return { order: existing, alreadyPaid: true };
    }

    const updated: Order = { ...existing, status: 'paid', paidAt, paymentReference };
    this.orders.set(orderId, updated);
    return { order: updated, alreadyPaid: false };
  }
}
