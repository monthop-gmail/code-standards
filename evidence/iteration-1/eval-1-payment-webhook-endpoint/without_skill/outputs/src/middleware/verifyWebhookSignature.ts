import type { NextFunction, Request, Response } from 'express';
import { verifySignature } from '../services/signature';
import { InvalidPayloadError, InvalidSignatureError } from '../utils/errors';

export const SIGNATURE_HEADER = 'x-payment-signature';

export interface SignatureMiddlewareOptions {
  readonly secret: string;
  readonly toleranceSeconds: number;
  readonly now?: () => number;
}

/**
 * Must run on a route mounted with `express.raw()`: the HMAC is computed over
 * the exact bytes received, so any re-serialization would break verification.
 */
export function verifyWebhookSignature(options: SignatureMiddlewareOptions) {
  return function verifyWebhookSignatureMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    if (!Buffer.isBuffer(req.body)) {
      next(new InvalidPayloadError('Expected a raw request body'));
      return;
    }

    const ok = verifySignature(req.body, req.header(SIGNATURE_HEADER), {
      secret: options.secret,
      toleranceSeconds: options.toleranceSeconds,
      ...(options.now ? { now: options.now } : {}),
    });

    next(ok ? undefined : new InvalidSignatureError());
  };
}
