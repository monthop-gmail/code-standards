export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'refunded';

export interface OrderCustomer {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface OrderItem {
  readonly sku: string;
  readonly name: string;
  readonly quantity: number;
  /** Minor units (e.g. satang / cents). Never floats for money. */
  readonly unitAmount: number;
}

export interface Order {
  readonly id: string;
  readonly status: OrderStatus;
  /** Minor units. */
  readonly totalAmount: number;
  readonly currency: string;
  readonly customer: OrderCustomer;
  readonly items: readonly OrderItem[];
  readonly paidAt: Date | null;
  readonly paymentReference: string | null;
}
