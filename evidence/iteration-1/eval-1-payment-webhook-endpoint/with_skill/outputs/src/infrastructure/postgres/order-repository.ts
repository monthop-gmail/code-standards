import type pg from 'pg';
import { PersistenceError } from '../../errors.js';
import { ORDER_STATUSES, type Order, type OrderStatus } from '../../domain/order.js';
import type { OrderRepository, OrderTransaction, RecordedPaymentEvent } from '../../application/ports.js';

interface OrderRow {
  readonly id: string;
  readonly customer_email: string;
  /** BIGINT comes back from pg as a string to avoid silent precision loss. */
  readonly amount_minor_units: string;
  readonly currency: string;
  readonly status: string;
  readonly payment_id: string | null;
}

function toOrder(row: OrderRow): Order {
  const amountMinorUnits = Number(row.amount_minor_units);
  if (!Number.isSafeInteger(amountMinorUnits)) {
    throw new PersistenceError('order amount exceeds the safe integer range', {
      context: { orderId: row.id },
    });
  }
  if (!isOrderStatus(row.status)) {
    throw new PersistenceError('order has an unknown status', {
      context: { orderId: row.id, status: row.status },
    });
  }
  return {
    id: row.id,
    customerEmail: row.customer_email,
    amountMinorUnits,
    currency: row.currency,
    status: row.status,
    paymentId: row.payment_id,
  };
}

function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

class PostgresOrderTransaction implements OrderTransaction {
  constructor(private readonly client: pg.PoolClient) {}

  async claimEvent(event: RecordedPaymentEvent): Promise<boolean> {
    // ON CONFLICT DO NOTHING makes the primary key the concurrency control:
    // two simultaneous deliveries of the same event cannot both return true.
    const result = await this.client.query(
      `INSERT INTO payment_events (event_id, payment_id, order_id, received_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.eventId, event.paymentId, event.orderId, event.receivedAt],
    );
    return result.rowCount === 1;
  }

  async findOrderForUpdate(orderId: string): Promise<Order | null> {
    const result = await this.client.query<OrderRow>(
      `SELECT id, customer_email, amount_minor_units, currency, status, payment_id
         FROM orders
        WHERE id = $1
        FOR UPDATE`,
      [orderId],
    );
    const row = result.rows[0];
    return row ? toOrder(row) : null;
  }

  async markPaid(orderId: string, paymentId: string, paidAt: Date): Promise<void> {
    // The status guard repeats the domain rule as a last line of defence: even
    // if a future caller skips decidePayment, a non-pending order cannot flip.
    const result = await this.client.query(
      `UPDATE orders
          SET status = 'paid', payment_id = $2, paid_at = $3, updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [orderId, paymentId, paidAt],
    );
    if (result.rowCount !== 1) {
      throw new PersistenceError('order was not in a payable state at update time', {
        context: { orderId, paymentId },
      });
    }
  }
}

export class PostgresOrderRepository implements OrderRepository {
  constructor(private readonly pool: pg.Pool) {}

  async runInTransaction<T>(work: (tx: OrderTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new PostgresOrderTransaction(client));
      await client.query('COMMIT');
      return result;
    } catch (cause) {
      await rollbackQuietly(client, cause);
      throw cause instanceof PersistenceError
        ? cause
        : new PersistenceError('order transaction failed', { cause });
    } finally {
      client.release();
    }
  }

  async markConfirmationEmailSent(orderId: string, sentAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE orders SET confirmation_email_sent_at = $2, updated_at = now() WHERE id = $1`,
      [orderId, sentAt],
    );
  }
}

/**
 * A rollback can itself fail (connection already dropped). Losing that detail is
 * acceptable, losing the original error is not — so it is attached as the cause.
 */
async function rollbackQuietly(client: pg.PoolClient, originalCause: unknown): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    throw new PersistenceError('rollback failed after a transaction error', {
      cause: originalCause,
      context: { rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) },
    });
  }
}
