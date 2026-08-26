import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Never let secrets or PII-heavy fields reach the log sink.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-payment-signature"]',
      'payload.customer.email',
      '*.password',
    ],
    censor: '[redacted]',
  },
});

export type Logger = typeof logger;
