import express, { Router, type Request, type Response } from 'express';
import type { AppConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { ConfirmOrderPayment } from '../../application/confirm-order-payment.js';
import { PAYMENT_SUCCEEDED_EVENT, parsePaymentNotification } from '../../webhook/schema.js';
import { SIGNATURE_HEADER, verifyWebhookSignature } from '../../webhook/signature.js';
import { apiError } from '../error-handler.js';

/** A signed gateway event is a few hundred bytes; anything larger is not ours. */
const MAX_WEBHOOK_BODY = '64kb';

export interface PaymentWebhookDependencies {
  readonly config: Pick<AppConfig, 'PAYMENT_WEBHOOK_SECRET' | 'PAYMENT_WEBHOOK_TOLERANCE_SECONDS'>;
  readonly logger: Logger;
  readonly confirmOrderPayment: ConfirmOrderPayment;
}

/**
 * HTTP status policy, because it decides whether the gateway retries:
 *  - 401 invalid/absent signature  -> not our caller, no retry wanted
 *  - 400 unparseable or invalid    -> retrying identical bytes cannot help
 *  - 200 accepted / duplicate / business-rejected -> stop retrying; rejects are
 *        logged as errors for reconciliation instead of being bounced forever
 *  - 500 unexpected failure        -> please redeliver (handled by errorHandler)
 */
export function createPaymentWebhookRouter(deps: PaymentWebhookDependencies): Router {
  const router = Router();

  router.post(
    '/payments/webhook',
    // Raw, not JSON: the signature covers the exact bytes sent. Re-serialising a
    // parsed object changes key order and whitespace and breaks verification.
    express.raw({ type: '*/*', limit: MAX_WEBHOOK_BODY }),
    (req: Request, res: Response, next) => {
      void handleWebhook(deps, req, res).catch(next);
    },
  );

  return router;
}

async function handleWebhook(
  deps: PaymentWebhookDependencies,
  req: Request,
  res: Response,
): Promise<void> {
  const log = deps.logger.child({ requestId: req.requestId });
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  const verification = verifyWebhookSignature({
    rawBody,
    header: req.get(SIGNATURE_HEADER),
    secret: deps.config.PAYMENT_WEBHOOK_SECRET,
    toleranceSeconds: deps.config.PAYMENT_WEBHOOK_TOLERANCE_SECONDS,
    now: new Date(),
  });

  if (!verification.ok) {
    // The reason is logged for us but never returned: telling a prober which
    // half of the check failed helps them, not us.
    log.warn({ reason: verification.reason, ip: req.ip }, 'rejected webhook with invalid signature');
    res.status(401).json(apiError('invalid_signature', 'Signature verification failed'));
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    log.warn({}, 'rejected webhook with malformed JSON body');
    res.status(400).json(apiError('invalid_payload', 'Request body is not valid JSON'));
    return;
  }

  const parsed = parsePaymentNotification(payload);
  if (!parsed.ok) {
    log.warn({ issues: parsed.issues }, 'rejected webhook that failed schema validation');
    res
      .status(400)
      .json(apiError('invalid_payload', 'Event payload failed validation', { details: parsed.issues }));
    return;
  }

  const notification = parsed.notification;
  if (notification.type !== PAYMENT_SUCCEEDED_EVENT) {
    // Gateways send many event types down one endpoint; acknowledging the ones
    // we do not act on keeps them out of the retry queue.
    log.debug({ eventId: notification.eventId, type: notification.type }, 'ignoring unsupported event type');
    res.status(200).json({ status: 'ignored', reason: 'unsupported_event_type' });
    return;
  }

  const outcome = await deps.confirmOrderPayment.execute(notification);
  res.status(200).json(outcome);
}
