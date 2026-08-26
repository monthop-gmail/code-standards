'use strict';

const express = require('express');

const { asyncHandler, requireAuth } = require('../http/middleware');
const { validateCreateOrderPayload, validateOrderId } = require('./order.validation');

/**
 * ชั้น HTTP ล้วน: แปลง request → input ที่ validate แล้ว, เรียก service, เลือก status code
 * ไม่มี business logic และไม่มี SQL อยู่ในไฟล์นี้เลย
 *
 * @param {{ service: ReturnType<typeof import('./order.service').createOrderService> }} deps
 * @returns {import('express').Router}
 */
function createOrderRouter({ service }) {
  const router = express.Router();

  router.post(
    '/orders',
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = validateCreateOrderPayload(req.body);
      const order = await service.createOrder(req.user.id, input);
      res.status(201).json({ data: order });
    })
  );

  router.get(
    '/orders/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const orderId = validateOrderId(req.params.id);
      const order = await service.getOrder(orderId, req.user.id);
      res.status(200).json({ data: order });
    })
  );

  return router;
}

module.exports = { createOrderRouter };
