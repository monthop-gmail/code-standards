'use strict';

/**
 * Wraps an async route handler so a rejected promise reaches Express's error
 * middleware. The legacy GET /orders/:id had no try/catch at all, so any DB
 * error became an unhandled rejection and the client hung until timeout.
 */
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

module.exports = { asyncHandler };
