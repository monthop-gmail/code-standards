import type { Order } from '../../src/domain/order.js';
import type {
  EmailSender,
  OrderPaidEmail,
  OrderRepository,
  OrderTransaction,
  RecordedPaymentEvent,
} from '../../src/application/ports.js';
import type { Logger } from '../../src/logger.js';

export function silentLogger(): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  };
  return logger;
}

/**
 * In-memory stand-in for PostgresOrderRepository. It reproduces the two
 * behaviours the use case relies on — the event id claim is exclusive, and a
 * failing unit of work leaves no trace — so the tests exercise the real
 * orchestration rather than a mock that always agrees.
 */
export class InMemoryOrderRepository implements OrderRepository {
  private orders = new Map<string, Order>();
  private events = new Map<string, RecordedPaymentEvent>();
  private tail: Promise<void> = Promise.resolve();
  readonly paidAt = new Map<string, Date>();
  readonly emailSentAt = new Map<string, Date>();
  /** Set to make the next transaction blow up, standing in for a database outage. */
  failNextTransactionWith: Error | null = null;

  constructor(orders: readonly Order[] = []) {
    for (const order of orders) {
      this.orders.set(order.id, order);
    }
  }

  get(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  hasEvent(eventId: string): boolean {
    return this.events.has(eventId);
  }

  async runInTransaction<T>(work: (tx: OrderTransaction) => Promise<T>): Promise<T> {
    // Transactions are serialised, which is the behaviour SELECT ... FOR UPDATE
    // gives the real repository: two concurrent deliveries for one order cannot
    // read a stale copy of it.
    const run = this.tail.then(() => this.runExclusively(work));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runExclusively<T>(work: (tx: OrderTransaction) => Promise<T>): Promise<T> {
    const failure = this.failNextTransactionWith;
    if (failure) {
      this.failNextTransactionWith = null;
      throw failure;
    }

    const stagedOrders = new Map(this.orders);
    const stagedEvents = new Map(this.events);
    const tx: OrderTransaction = {
      claimEvent: (event) => {
        if (stagedEvents.has(event.eventId)) {
          return Promise.resolve(false);
        }
        stagedEvents.set(event.eventId, event);
        return Promise.resolve(true);
      },
      findOrderForUpdate: (orderId) => Promise.resolve(stagedOrders.get(orderId) ?? null),
      markPaid: (orderId, paymentId, paidAt) => {
        const order = stagedOrders.get(orderId);
        if (!order || order.status !== 'pending') {
          return Promise.reject(new Error(`order ${orderId} is not pending`));
        }
        stagedOrders.set(orderId, { ...order, status: 'paid', paymentId });
        this.paidAt.set(orderId, paidAt);
        return Promise.resolve();
      },
    };

    // Staged copies are only published on success, so a throw rolls everything
    // back — including the event claim.
    const result = await work(tx);
    this.orders = stagedOrders;
    this.events = stagedEvents;
    return result;
  }

  markConfirmationEmailSent(orderId: string, sentAt: Date): Promise<void> {
    this.emailSentAt.set(orderId, sentAt);
    return Promise.resolve();
  }
}

export class RecordingEmailSender implements EmailSender {
  readonly sent: OrderPaidEmail[] = [];
  failWith: Error | null = null;

  sendOrderPaidConfirmation(message: OrderPaidEmail): Promise<void> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

export function pendingOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ord_1001',
    customerEmail: 'customer@example.com',
    amountMinorUnits: 125_000,
    currency: 'THB',
    status: 'pending',
    paymentId: null,
    ...overrides,
  };
}
