import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createPool } from './infrastructure/postgres/pool.js';
import { PostgresOrderRepository } from './infrastructure/postgres/order-repository.js';
import { NodemailerEmailSender } from './infrastructure/email/nodemailer-email-sender.js';
import { ConfirmOrderPayment } from './application/confirm-order-payment.js';
import { createApp } from './http/app.js';

const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  const pool = createPool(config);
  // A pool error outside a query (dead backend, network drop) is emitted here;
  // without a listener it would crash the process.
  pool.on('error', (error: Error) => {
    logger.error({ error: error.message }, 'idle database client errored');
  });

  const orders = new PostgresOrderRepository(pool);
  const email = new NodemailerEmailSender(config);
  const confirmOrderPayment = new ConfirmOrderPayment({ orders, email, logger });

  const app = createApp({
    config,
    logger,
    confirmOrderPayment,
    checkReadiness: async () => {
      await pool.query('SELECT 1');
    },
  });

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'payment webhook service listening');
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // Stop accepting connections, let in-flight webhooks finish, then release
    // the pool — dropping a request mid-transaction means a redelivery that a
    // clean close avoids.
    const forceExit = setTimeout(() => {
      logger.error({ signal }, 'graceful shutdown timed out, exiting');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    server.close((closeError?: Error) => {
      if (closeError) {
        logger.error({ error: closeError.message }, 'error while closing http server');
      }
      void Promise.allSettled([email.close(), pool.end()]).then(() => {
        logger.info({ signal }, 'shutdown complete');
        process.exit(closeError ? 1 : 0);
      });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error({ reason: reason instanceof Error ? reason.stack : String(reason) }, 'unhandled rejection');
  });
  process.on('uncaughtException', (error: Error) => {
    logger.error({ error: error.stack }, 'uncaught exception, exiting');
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  // The logger may not exist yet (bad config), so this one path writes to stderr.
  process.stderr.write(`fatal: failed to start service: ${String(error)}\n`);
  process.exit(1);
});
