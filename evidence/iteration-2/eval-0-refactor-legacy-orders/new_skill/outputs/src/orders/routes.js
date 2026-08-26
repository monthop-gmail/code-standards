'use strict';

const express = require('express');

const { AppError } = require('../errors');
const { toMajorUnits } = require('../money');
const { createOrder, getOrderForUser } = require('./service');
const { parseCreateOrderInput, parseIdParam, asPositiveInt } = require('./validation');

/**
 * ชั้น HTTP ล้วน: อ่าน request → เรียก use case → แปลงผลเป็น response
 * ไม่มี business logic และไม่มี SQL อยู่ในไฟล์นี้
 */

const router = express.Router();

router.post(
  '/orders',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const input = parseCreateOrderInput(req.body);
    const { orderId, quote } = await createOrder({ userId, input });

    res.status(201).json({
      ok: true,
      orderId,
      total: toMajorUnits(quote.totalMinor),
    });
  }),
);

router.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const orderId = parseIdParam(req.params.id, 'order id');
    const order = await getOrderForUser({ orderId, userId });

    res.json(order);
  }),
);

router.use(errorHandler);

/**
 * ตัวตนผู้ใช้ต้องมาจาก auth middleware ที่ mount ไว้ก่อน router นี้เท่านั้น
 *
 * เดิม endpoint สร้าง order เชื่อ `req.body.userId` ตรง ๆ แปลว่าใครก็สั่งของในนามคนอื่นได้
 * และ GET ไม่เช็คเจ้าของเลย ใครเดา id ถูกก็อ่านออเดอร์ชาวบ้านได้ทั้งระบบ
 *
 * @param {import('express').Request} req
 * @returns {number}
 * @throws {AppError} 401 เมื่อ request ยังไม่ได้ผ่าน authentication
 */
function requireUserId(req) {
  const userId = asPositiveInt(req.user?.id);
  if (userId === null) {
    throw new AppError('UNAUTHENTICATED', 'authentication required', 401);
  }
  return userId;
}

/**
 * ส่ง rejection ของ async handler เข้า error middleware ของ express
 * (express 4 ไม่จับ promise ที่ reject ให้เอง — ปล่อยไว้จะกลายเป็น request ที่ค้างไม่ตอบ)
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<void>} handler
 * @returns {import('express').RequestHandler}
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

/**
 * จุดรวมการแปลง error เป็น response — error ที่เราตั้งใจให้เกิดตอบตามรหัสของมัน
 * ส่วนที่เหลือคือของที่ไม่คาดคิด: log เต็ม ๆ ฝั่ง server แล้วตอบ 500 กลาง ๆ
 * ไม่ปล่อย stack trace หรือข้อความจาก driver ออกไปหา client
 *
 * @type {import('express').ErrorRequestHandler}
 */
function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  console.error(
    JSON.stringify({
      event: 'unhandled_route_error',
      method: req.method,
      path: req.path,
      userId: req.user?.id ?? null,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );

  res.status(500).json({
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'internal server error' },
  });
}

module.exports = router;
