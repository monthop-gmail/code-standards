import { z } from 'zod';
import { normalizeCurrency } from '../domain/money.js';

export const PAYMENT_SUCCEEDED_EVENT = 'payment.succeeded';

/**
 * Shape as delivered by the gateway (snake_case). Everything crossing the trust
 * boundary is validated here and converted into an internal camelCase object,
 * so no raw gateway payload travels further into the application.
 *
 * Lengths are bounded on every string: an unbounded `id` would end up in a
 * database column and in log lines.
 */
const paymentEventSchema = z.object({
  id: z.string().trim().min(1).max(255),
  type: z.string().trim().min(1).max(100),
  created_at: z.coerce.date(),
  data: z.object({
    payment_id: z.string().trim().min(1).max(255),
    order_id: z.string().trim().min(1).max(64),
    // Minor units. Non-negative integer only: floats and negatives are a
    // refund/mis-serialisation signal, not a successful charge.
    amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/),
  }),
});

export interface PaymentNotification {
  readonly eventId: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly paymentId: string;
  readonly orderId: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
}

export type PaymentNotificationParseResult =
  | { readonly ok: true; readonly notification: PaymentNotification }
  | { readonly ok: false; readonly issues: readonly string[] };

export function parsePaymentNotification(payload: unknown): PaymentNotificationParseResult {
  const parsed = paymentEventSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    };
  }

  const { id, type, created_at: createdAt, data } = parsed.data;
  return {
    ok: true,
    notification: {
      eventId: id,
      type,
      occurredAt: createdAt,
      paymentId: data.payment_id,
      orderId: data.order_id,
      amountMinorUnits: data.amount,
      currency: normalizeCurrency(data.currency),
    },
  };
}
