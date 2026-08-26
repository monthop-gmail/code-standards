import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { verifyWebhookSignature } from '../middleware/verifyWebhookSignature';
import { InvalidPayloadError } from '../utils/errors';
import { paymentWebhookEventSchema } from '../types/webhook';
import type { PaymentWebhookService } from '../services/paymentWebhookService';

export interface PaymentWebhookRouterOptions {
  readonly service: PaymentWebhookService;
  readonly secret: string;
  readonly toleranceSeconds: number;
  readonly now?: () => number;
  /** Body size cap; webhook payloads are small, so keep it tight. */
  readonly bodyLimit?: string;
}

function parseEvent(rawBody: Buffer) {
  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new InvalidPayloadError('Body is not valid JSON');
  }

  const parsed = paymentWebhookEventSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new InvalidPayloadError(`Payload does not match the expected schema (${detail})`);
  }
  return parsed.data;
}

export function createPaymentWebhookRouter(options: PaymentWebhookRouterOptions): Router {
  const router = Router();

  router.post(
    '/payments',
    express.raw({ type: '*/*', limit: options.bodyLimit ?? '64kb' }),
    verifyWebhookSignature({
      secret: options.secret,
      toleranceSeconds: options.toleranceSeconds,
      ...(options.now ? { now: options.now } : {}),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const event = parseEvent(req.body as Buffer);
        const result = await options.service.handleEvent(event);
        // 200 tells the gateway to stop retrying. Anything the gateway should
        // retry must surface as a 4xx/5xx via the error handler instead.
        res.status(200).json({ received: true, outcome: result.outcome });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
