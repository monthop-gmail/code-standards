import type { Order } from '../domain/order.js';

export interface RecordedPaymentEvent {
  readonly eventId: string;
  readonly paymentId: string;
  readonly orderId: string;
  readonly receivedAt: Date;
}

/**
 * Work that must either all happen or none of it: claiming the event id,
 * reading the order under a row lock, and flipping it to paid.
 */
export interface OrderTransaction {
  /**
   * Claims the gateway event id. Returns false when the id was already stored,
   * which is how redeliveries are made harmless. Claiming inside the same
   * transaction as the state change is deliberate: if the transaction rolls
   * back, the claim disappears with it and the redelivery can be processed.
   */
  claimEvent(event: RecordedPaymentEvent): Promise<boolean>;

  /** Reads the order with a row-level lock so two concurrent deliveries cannot both apply a payment. */
  findOrderForUpdate(orderId: string): Promise<Order | null>;

  markPaid(orderId: string, paymentId: string, paidAt: Date): Promise<void>;
}

export interface OrderRepository {
  runInTransaction<T>(work: (tx: OrderTransaction) => Promise<T>): Promise<T>;

  /** Recorded after the confirmation mail is accepted by SMTP so a sweeper can retry the ones left null. */
  markConfirmationEmailSent(orderId: string, sentAt: Date): Promise<void>;
}

export interface OrderPaidEmail {
  readonly to: string;
  readonly orderId: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly paidAt: Date;
}

export interface EmailSender {
  sendOrderPaidConfirmation(message: OrderPaidEmail): Promise<void>;
}
