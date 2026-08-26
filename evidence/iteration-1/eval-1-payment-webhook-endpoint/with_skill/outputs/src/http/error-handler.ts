import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import type { Logger } from '../logger.js';
import { AppError } from '../errors.js';

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId?: string;
    readonly details?: readonly string[];
  };
}

export function apiError(
  code: string,
  message: string,
  extra: { requestId?: string; details?: readonly string[] } = {},
): ApiErrorBody {
  return {
    error: {
      code,
      message,
      ...(extra.requestId === undefined ? {} : { requestId: extra.requestId }),
      ...(extra.details === undefined ? {} : { details: extra.details }),
    },
  };
}

export function notFoundHandler() {
  return (req: Request, res: Response): void => {
    res.status(404).json(apiError('not_found', 'Unknown endpoint', { requestId: req.requestId }));
  };
}

/**
 * The edge catch-all. Everything that reaches here is a bug or a downed
 * dependency: it is logged with full context and answered with a 500 and no
 * internal detail, which is also the signal the gateway needs in order to
 * redeliver the event.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }

    logger.error(
      {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        context: error instanceof AppError ? error.context : undefined,
      },
      'unhandled error while serving request',
    );

    res
      .status(500)
      .json(apiError('internal_error', 'Unexpected error, please retry', { requestId: req.requestId }));
  };
}
