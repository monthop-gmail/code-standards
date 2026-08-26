import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { ConfirmOrderPayment } from '../application/confirm-order-payment.js';
import { errorHandler, notFoundHandler } from './error-handler.js';
import { requestContext } from './request-context.js';
import { createPaymentWebhookRouter } from './routes/payment-webhook.js';

export const API_PREFIX = '/api/v1';

export interface AppDependencies {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly confirmOrderPayment: ConfirmOrderPayment;
  /** Throws when a downstream dependency is unusable; used by the readiness probe. */
  readonly checkReadiness: () => Promise<void>;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  // Behind a load balancer this makes req.ip the real client address rather
  // than the proxy's; keep it in sync with your actual hop count.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // No browser ever loads this service, so the CSP/CORS surface stays closed:
  // helmet's defaults are exactly right and no CORS middleware is installed.
  app.use(helmet());
  app.use(requestContext());

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/readyz', (req: Request, res: Response) => {
    void deps
      .checkReadiness()
      .then(() => res.status(200).json({ status: 'ready' }))
      .catch((error: unknown) => {
        deps.logger.error(
          {
            requestId: req.requestId,
            error: error instanceof Error ? error.message : String(error),
          },
          'readiness check failed',
        );
        res.status(503).json({ status: 'unavailable' });
      });
  });

  app.use(
    API_PREFIX,
    createPaymentWebhookRouter({
      config: deps.config,
      logger: deps.logger,
      confirmOrderPayment: deps.confirmOrderPayment,
    }),
  );

  app.use(notFoundHandler());
  app.use(errorHandler(deps.logger));

  return app;
}
