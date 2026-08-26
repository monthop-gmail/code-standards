import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type Express, type NextFunction, type Request, type Response } from 'express';
import { pool } from '../db.js';
import { describeError, logger } from '../logger.js';
import { paymentWebhookRouter } from '../payments/webhookRoute.js';

const REQUEST_ID_HEADER = 'X-Request-Id';

export function createApp(): Express {
  const app = express();

  // ไม่บอกโลกว่ารันด้วยอะไร
  app.disable('x-powered-by');
  // อยู่หลัง reverse proxy (nginx/ALB) — ให้ req.ip เป็น IP จริงของผู้เรียก
  app.set('trust proxy', 1);

  app.use(attachRequestId);

  app.get('/healthz', async (_req: Request, res: Response): Promise<void> => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      logger.error('health_check_failed', { error: describeError(error) });
      res.status(503).json({ status: 'unavailable' });
    }
  });

  // ตั้ง version ตั้งแต่วันแรก — เปลี่ยน path ทีหลังต้องไปแก้ config ฝั่ง gateway
  app.use('/api/v1/webhooks', paymentWebhookRouter);

  app.use((_req: Request, res: Response): void => {
    res.status(404).json({ error: { code: 'not_found', message: 'ไม่พบ endpoint นี้' } });
  });

  app.use(handleUnexpectedError);

  return app;
}

function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(REQUEST_ID_HEADER);
  const requestId = incoming !== undefined && incoming.length > 0 && incoming.length <= 128 ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

/**
 * catch-all ที่ขอบระบบ: log รายละเอียดไว้ฝั่งเรา แต่ตอบ client ด้วยข้อความกลาง ๆ
 * ห้ามส่ง stack trace หรือข้อความจาก driver ออกไป (รั่วโครงสร้าง DB)
 */
const handleUnexpectedError: ErrorRequestHandler = (error, req, res, _next): void => {
  const requestId = res.getHeader(REQUEST_ID_HEADER);
  const status = extractClientErrorStatus(error);

  if (status !== null) {
    // error ที่ middleware ของ express โยนเอง เช่น body ใหญ่เกิน limit (413)
    logger.warn('request_rejected', { requestId, status, path: req.path, error: describeError(error) });
    res.status(status).json({ error: { code: 'bad_request', message: 'คำขอไม่ถูกต้อง' } });
    return;
  }

  logger.error('unhandled_request_error', {
    requestId,
    method: req.method,
    path: req.path,
    error: describeError(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  res.status(500).json({ error: { code: 'internal_error', message: 'เกิดข้อผิดพลาดภายในระบบ' } });
};

function extractClientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status: unknown = (error as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}
