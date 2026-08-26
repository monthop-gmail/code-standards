export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** Signature/format problems — the gateway must not retry these. */
export class InvalidSignatureError extends AppError {
  constructor(message = 'Invalid webhook signature') {
    super(message, 401, 'invalid_signature');
  }
}

export class InvalidPayloadError extends AppError {
  constructor(message = 'Invalid webhook payload') {
    super(message, 400, 'invalid_payload');
  }
}

export class OrderNotFoundError extends AppError {
  constructor(orderId: string) {
    super(`Order ${orderId} not found`, 404, 'order_not_found');
  }
}

/** Business conflict (e.g. amount mismatch) — retrying will not help. */
export class OrderConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'order_conflict');
  }
}
