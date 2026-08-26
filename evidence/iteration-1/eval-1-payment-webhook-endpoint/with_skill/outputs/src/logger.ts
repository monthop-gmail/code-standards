import pino from 'pino';
import type { AppConfig } from './config.js';

/**
 * The application depends on this narrow interface instead of pino directly:
 * it keeps the swap-in silent logger in tests trivial and stops log-library
 * types leaking into the domain.
 */
export interface Logger {
  debug(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
  child(context: Record<string, unknown>): Logger;
}

class PinoLogger implements Logger {
  constructor(private readonly inner: pino.Logger) {}

  debug(context: Record<string, unknown>, message: string): void {
    this.inner.debug(context, message);
  }

  info(context: Record<string, unknown>, message: string): void {
    this.inner.info(context, message);
  }

  warn(context: Record<string, unknown>, message: string): void {
    this.inner.warn(context, message);
  }

  error(context: Record<string, unknown>, message: string): void {
    this.inner.error(context, message);
  }

  child(context: Record<string, unknown>): Logger {
    return new PinoLogger(this.inner.child(context));
  }
}

export function createLogger(config: Pick<AppConfig, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return new PinoLogger(
    pino({
      level: config.LOG_LEVEL,
      base: { service: 'payment-webhook-service', env: config.NODE_ENV },
      // Belt and braces: nothing in this service intentionally logs these, but a
      // future `req.headers` dump must not spill signatures or credentials.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-payment-signature"]',
          'signature',
          'secret',
          'password',
        ],
        censor: '[redacted]',
      },
    }),
  );
}
