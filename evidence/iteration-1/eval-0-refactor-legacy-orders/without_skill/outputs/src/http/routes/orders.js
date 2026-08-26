'use strict';

const express = require('express');

const { asyncHandler } = require('../middleware/asyncHandler');
const { validateCreateOrder, validateOrderId } = require('../validators/orderValidators');
const { AppError } = require('../../errors/AppError');

/**
 * Orders routes.
 *
 * The router is a factory that takes its dependencies, so the module no
 * longer creates a database pool as an import side effect. That is what made
 * the legacy file impossible to unit-test: `require`-ing it opened a real
 * connection to the production database.
 *
 * Handlers here do one job: translate HTTP <-> the service layer.
 *
 * @param {{orderService: import('../../services/orderService').OrderService, limits: object}} deps
 * @returns {import('express').Router}
 */
function createOrdersRouter({ orderService, limits }) {
  const router = express.Router();

  router.post(
    '/orders',
    asyncHandler(async (req, res) => {
      const input = validateCreateOrder(req.body, limits);

      // SECURITY: the caller must not be able to place an order on someone
      // else's account. If authentication middleware has populated req.user,
      // it wins over anything in the body.
      const authenticatedUserId = req.user?.id;
      if (authenticatedUserId !== undefined && authenticatedUserId !== input.userId) {
        throw new AppError('FORBIDDEN', 'Cannot create an order for another user.', 403);
      }

      const order = await orderService.createOrder({
        ...input,
        userId: authenticatedUserId ?? input.userId,
      });

      res.status(201).json(order);
    }),
  );

  router.get(
    '/orders/:id',
    asyncHandler(async (req, res) => {
      const orderId = validateOrderId(req.params.id);
      const order = await orderService.getOrder(orderId);

      // SECURITY: any user could read any order by guessing an id in the
      // legacy version. Enforce ownership when we know who is asking.
      if (req.user?.id !== undefined && order.userId !== req.user.id) {
        throw AppError.notFound(`Order ${orderId} was not found.`);
      }

      res.json(order);
    }),
  );

  return router;
}

module.exports = { createOrdersRouter };
