import type { Logger } from '../src/utils/logger';
import type { Order } from '../src/types/order';
import { computeSignature } from '../src/services/signature';

export const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
} as unknown as Logger;

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ord_1',
    status: 'pending',
    totalAmount: 25000,
    currency: 'THB',
    customer: { id: 'cus_1', email: 'buyer@example.com', name: 'Somchai' },
    items: [{ sku: 'SKU-1', name: 'Blue Mug', quantity: 2, unitAmount: 12500 }],
    paidAt: null,
    paymentReference: null,
    ...overrides,
  };
}

export interface EventOverrides {
  id?: string;
  type?: string;
  orderId?: string;
  paymentId?: string;
  amount?: number;
  currency?: string;
}

export function makeEventPayload(overrides: EventOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? 'evt_1',
    type: overrides.type ?? 'payment.succeeded',
    createdAt: new Date('2026-08-24T10:00:00.000Z').toISOString(),
    data: {
      paymentId: overrides.paymentId ?? 'pay_1',
      orderId: overrides.orderId ?? 'ord_1',
      amount: overrides.amount ?? 25000,
      currency: overrides.currency ?? 'THB',
      status: 'succeeded',
    },
  };
}

export const TEST_SECRET = 'test-secret-value-long-enough';
export const FIXED_NOW_MS = Date.parse('2026-08-24T10:00:05.000Z');

export function signBody(body: string, secret = TEST_SECRET, nowMs = FIXED_NOW_MS): string {
  const timestamp = Math.floor(nowMs / 1000);
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, Buffer.from(body, 'utf8'))}`;
}
