import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';

export function errorHandler(logger: Logger) {
  return function errorHandlerMiddleware(
    error: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof AppError) {
      logger.warn({ err: error, requestId: req.id, code: error.code }, 'Request rejected');
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
      return;
    }

    // Unknown failure: log the detail, return an opaque message to the caller.
    logger.error({ err: error, requestId: req.id }, 'Unhandled error');
    res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
  };
}
