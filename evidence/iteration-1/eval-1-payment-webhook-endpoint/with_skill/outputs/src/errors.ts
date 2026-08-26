export interface ErrorContext {
  readonly [key: string]: unknown;
}

/** Base for every error this service throws on purpose, so `instanceof AppError` separates our failures from bugs. */
export class AppError extends Error {
  readonly context: ErrorContext;

  constructor(message: string, options: { cause?: unknown; context?: ErrorContext } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.context = options.context ?? {};
  }
}

/** A database read/write failed. Retriable: the caller should let the gateway redeliver. */
export class PersistenceError extends AppError {}

/** The SMTP handoff failed. Not retriable by the gateway — the payment is already recorded. */
export class EmailDeliveryError extends AppError {}
