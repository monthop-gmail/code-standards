'use strict';

const { AppError } = require('../../errors/AppError');
const logger = require('../../lib/logger');

/**
 * Single place that turns an error into an HTTP response.
 *
 * The legacy handler answered every failure with HTTP 200 and `{ok:false}`,
 * so clients, load balancers and monitoring could not distinguish a bad
 * request from a database outage. Here the status code carries the meaning
 * and unexpected errors never leak internals to the caller.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity.
function errorHandler(error, req, res, next) {
  const requestId = req.id;

  if (error instanceof AppError) {
    logger.warn('request.failed', {
      requestId,
      path: req.path,
      code: error.code,
      status: error.status,
    });
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.details && { details: error.details }) },
    });
  }

  logger.error('request.unhandled_error', {
    requestId,
    path: req.path,
    message: error.message,
    stack: error.stack,
  });

  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  });
}

module.exports = { errorHandler };
