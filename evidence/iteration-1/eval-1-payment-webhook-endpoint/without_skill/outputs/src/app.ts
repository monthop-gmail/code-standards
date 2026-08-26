import express, { type Express } from 'express';
import { requestId } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { createPaymentWebhookRouter } from './routes/paymentWebhook';
import type { PaymentWebhookService } from './services/paymentWebhookService';
import type { Logger } from './utils/logger';

export interface CreateAppOptions {
  readonly service: PaymentWebhookService;
  readonly logger: Logger;
  readonly webhookSecret: string;
  readonly webhookToleranceSeconds: number;
  readonly now?: () => number;
}

export function createApp(options: CreateAppOptions): Express {
  const app = express();

  // Behind a load balancer / gateway proxy.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(requestId);

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use(
    '/webhooks',
    createPaymentWebhookRouter({
      service: options.service,
      secret: options.webhookSecret,
      toleranceSeconds: options.webhookToleranceSeconds,
      ...(options.now ? { now: options.now } : {}),
    }),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
  });

  app.use(errorHandler(options.logger));

  return app;
}
