import { loadEnv } from './config/env';
import { logger } from './utils/logger';
import { createApp } from './app';
import { PaymentWebhookService } from './services/paymentWebhookService';
import { SmtpEmailService } from './services/emailService';
import { InMemoryOrderRepository } from './repositories/orderRepository';
import { InMemoryProcessedEventStore } from './repositories/processedEventStore';

function main(): void {
  const env = loadEnv();

  // Swap these two for database-backed implementations in production.
  const orders = new InMemoryOrderRepository();
  const processedEvents = new InMemoryProcessedEventStore();

  const email = new SmtpEmailService({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.MAIL_FROM,
  });

  const service = new PaymentWebhookService({ orders, processedEvents, email, logger });

  const app = createApp({
    service,
    logger,
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
    webhookToleranceSeconds: env.PAYMENT_WEBHOOK_TOLERANCE_SECONDS,
  });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Payment webhook service listening');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    server.close((err) => {
      if (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
      process.exit(0);
    });
    // Do not hang forever on in-flight connections.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
