'use strict';

const { AppError, UnauthorizedError } = require('../errors');

/**
 * express 4 ไม่จับ rejected promise จาก async handler ให้ — ถ้าไม่ห่อ error จะกลายเป็น
 * unhandledRejection และ request ค้างจนกว่าจะ timeout (ของเดิม GET /orders/:id เป็นแบบนี้)
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<unknown>} handler
 * @returns {import('express').RequestHandler}
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

/**
 * ต้องมี authentication middleware ของแอปทำงานก่อนหน้านี้และเซ็ต `req.user`
 * middleware ตัวนี้ไม่ได้ทำ authentication เอง — หน้าที่มันคือ "ปฏิเสธถ้ายังไม่รู้ว่าใคร"
 * @type {import('express').RequestHandler}
 */
function requireAuth(req, _res, next) {
  const userId = req.user?.id;
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    next(new UnauthorizedError());
    return;
  }
  next();
}

/**
 * catch-all ที่ขอบระบบ: error ที่คาดไว้แล้วตอบข้อความจริง ส่วน error ที่ไม่คาด
 * ตอบข้อความกลาง ๆ (ไม่รั่ว SQL/stack/ชื่อ host) แล้ว log เต็มฝั่ง server
 * @param {{ error: (msg: string, meta?: object) => void }} logger
 * @returns {import('express').ErrorRequestHandler}
 */
function createErrorHandler(logger) {
  return (err, req, res, _next) => {
    const isExpected = err instanceof AppError && err.expected === true;
    const status = err instanceof AppError ? err.status : 500;

    if (!isExpected) {
      logger.error('request.failed', {
        method: req.method,
        path: req.path,
        userId: req.user?.id,
        code: err instanceof AppError ? err.code : 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    if (res.headersSent) return;

    res.status(status).json({
      error: isExpected
        ? { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) }
        : { code: 'INTERNAL_ERROR', message: 'Something went wrong while processing the request' },
    });
  };
}

module.exports = { asyncHandler, requireAuth, createErrorHandler };
