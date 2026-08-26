'use strict';

/**
 * Error type that carries an HTTP status and a machine-readable code.
 * Anything thrown that is NOT an AppError is treated as an unexpected
 * failure by the error handler and reported as a generic 500, so internal
 * details (SQL text, stack traces, hostnames) never reach the client.
 */
class AppError extends Error {
  /**
   * @param {string} code    stable, machine-readable identifier
   * @param {string} message safe-to-expose human message
   * @param {number} status  HTTP status code
   * @param {object} [details] optional structured context for the client
   */
  constructor(code, message, status, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message, details) {
    return new AppError('BAD_REQUEST', message, 400, details);
  }

  static validation(details) {
    return new AppError('VALIDATION_ERROR', 'Request body is invalid.', 422, details);
  }

  static notFound(message) {
    return new AppError('NOT_FOUND', message, 404);
  }

  static conflict(message, details) {
    return new AppError('CONFLICT', message, 409, details);
  }
}

module.exports = { AppError };
