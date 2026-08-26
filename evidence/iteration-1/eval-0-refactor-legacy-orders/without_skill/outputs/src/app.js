'use strict';

const express = require('express');

const { buildContainer } = require('./container');
const { errorHandler } = require('./http/middleware/errorHandler');
const { AppError } = require('./errors/AppError');

/**
 * Builds the Express application. Kept separate from server start-up so
 * tests can mount the app without binding a port.
 */
function createApp(overrides = {}) {
  const container = buildContainer(overrides);
  const app = express();

  app.use(express.json({ limit: '128kb' }));

  // NOTE: mount your authentication middleware here so that req.user is
  // populated before the orders router runs its ownership checks.
  app.use(container.ordersRouter);

  app.use((req, res, next) => next(AppError.notFound('Route not found.')));
  app.use(errorHandler);

  return { app, container };
}

module.exports = { createApp };
