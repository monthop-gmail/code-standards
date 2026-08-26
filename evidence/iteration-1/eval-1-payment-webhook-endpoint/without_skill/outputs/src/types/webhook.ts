import { z } from 'zod';

/**
 * Contract with the payment gateway. Unknown fields are stripped rather than
 * rejected so the gateway can add fields without breaking us.
 */
export const paymentWebhookEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  createdAt: z.coerce.date(),
  data: z.object({
    paymentId: z.string().min(1),
    orderId: z.string().min(1),
    /** Minor units, as sent by the gateway. */
    amount: z.number().int().nonnegative(),
    currency: z.string().length(3),
    status: z.string().min(1),
  }),
});

export type PaymentWebhookEvent = z.infer<typeof paymentWebhookEventSchema>;

export const PAYMENT_SUCCEEDED_EVENT = 'payment.succeeded';
