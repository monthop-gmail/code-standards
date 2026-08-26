import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { withTransaction } from '../db.js';
import { logger } from '../logger.js';
import { sendOrderConfirmationEmail } from '../email/mailer.js';
import { createOrderRepository, markConfirmationEmailSent, type OrderRepository } from './orderRepository.js';
import { processPaymentSucceeded, type PaymentServiceDeps, type ProcessPaymentResult } from './paymentService.js';
import { verifyWebhookSignature } from './signature.js';

const SIGNATURE_HEADER = 'x-payment-signature';
const PAYMENT_SUCCEEDED_EVENT_TYPE = 'payment.succeeded';
/** body ของ webhook เป็น JSON เล็ก ๆ — จำกัดขนาดกันคนยิงของใหญ่มาถล่ม */
const MAX_BODY_SIZE = '64kb';

/**
 * Schema ของ payload จาก gateway
 * ไม่ใช้ .strict() เพราะ gateway เพิ่ม field ใหม่ได้เรื่อย ๆ — field ที่ไม่รู้จักถูกตัดทิ้ง
 */
const paymentEventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  data: z.object({
    order_id: z.string().uuid(),
    payment_reference: z.string().min(1).max(200),
    /** หน่วยย่อย (สตางค์) — integer เท่านั้น */
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .transform((value) => value.toUpperCase()),
  }),
});

const serviceDeps: PaymentServiceDeps = {
  runInTransaction: <T>(fn: (repository: OrderRepository) => Promise<T>): Promise<T> =>
    withTransaction((client) => fn(createOrderRepository(client))),
  sendOrderConfirmationEmail,
  markConfirmationEmailSent,
  logger,
};

export const paymentWebhookRouter: Router = Router();

/**
 * POST /api/v1/webhooks/payments
 *
 * ลำดับสำคัญมาก: verify signature จาก raw bytes ก่อน แล้วค่อย parse JSON
 * ถ้า parse ก่อนแล้ว stringify ใหม่เพื่อ verify ไบต์จะไม่ตรงกับที่ gateway เซ็น
 */
paymentWebhookRouter.post(
  '/payments',
  express.raw({ type: 'application/json', limit: MAX_BODY_SIZE }),
  async (req: Request, res: Response): Promise<void> => {
    const requestId = readRequestId(res);
    const rawBody: unknown = req.body;

    if (!Buffer.isBuffer(rawBody)) {
      // เกิดเมื่อ Content-Type ไม่ใช่ application/json → express.raw ไม่ได้อ่าน body ให้
      sendError(res, 400, 'invalid_content_type', 'Content-Type ต้องเป็น application/json');
      return;
    }

    const signature = verifyWebhookSignature({
      payload: rawBody,
      header: req.get(SIGNATURE_HEADER),
      secret: config.PAYMENT_WEBHOOK_SECRET,
      toleranceSeconds: config.PAYMENT_WEBHOOK_TOLERANCE_SECONDS,
    });
    if (!signature.valid) {
      // ไม่ log body และไม่บอก client ว่าพลาดตรงไหน — บอกแค่ใน log ฝั่งเรา
      logger.warn('payment_webhook_signature_rejected', { requestId, reason: signature.reason });
      sendError(res, 401, 'invalid_signature', 'signature ไม่ถูกต้อง');
      return;
    }

    const payload = parseJson(rawBody);
    if (payload === undefined) {
      logger.warn('payment_webhook_invalid_json', { requestId, bodyBytes: rawBody.byteLength });
      sendError(res, 400, 'invalid_json', 'body ไม่ใช่ JSON ที่ถูกต้อง');
      return;
    }

    const parsed = paymentEventSchema.safeParse(payload);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      logger.warn('payment_webhook_invalid_payload', { requestId, issues });
      sendError(res, 400, 'invalid_payload', 'payload ไม่ตรงกับรูปแบบที่รองรับ');
      return;
    }

    const event = parsed.data;
    if (event.type !== PAYMENT_SUCCEEDED_EVENT_TYPE) {
      // ตอบ 200 เพื่อไม่ให้ gateway retry event ที่เราตั้งใจไม่สนใจ
      logger.debug('payment_webhook_event_ignored', { requestId, eventType: event.type });
      res.status(200).json({ status: 'ignored' });
      return;
    }

    const result = await processPaymentSucceeded(serviceDeps, {
      eventId: event.id,
      eventType: event.type,
      orderId: event.data.order_id,
      paymentReference: event.data.payment_reference,
      amountMinorUnits: event.data.amount,
      currency: event.data.currency,
    });

    respondWithOutcome(res, result, requestId, event.id);
  },
);

function respondWithOutcome(
  res: Response,
  result: ProcessPaymentResult,
  requestId: string | undefined,
  eventId: string,
): void {
  switch (result.outcome) {
    case 'processed':
      res.status(200).json({
        status: 'ok',
        outcome: result.outcome,
        confirmation_email_sent: result.confirmationEmailSent,
      });
      return;

    case 'duplicate_event':
    case 'order_already_paid':
      // งานถูกทำไปแล้ว — ตอบ 200 เพื่อให้ gateway หยุด retry
      logger.info('payment_webhook_no_op', { requestId, eventId, outcome: result.outcome });
      res.status(200).json({ status: 'ok', outcome: result.outcome });
      return;

    case 'order_not_payable':
      // order ถูกยกเลิก/คืนเงินไปแล้วแต่เงินเข้า — ต้องมีคนดู แต่ retry ไม่ช่วย
      logger.error('payment_for_non_payable_order', { requestId, eventId, status: result.status });
      res.status(200).json({ status: 'ok', outcome: result.outcome });
      return;

    case 'order_not_found':
      // 404 เพื่อให้ gateway retry — เผื่อ webhook วิ่งมาถึงก่อน order ถูก commit
      logger.error('payment_webhook_order_not_found', { requestId, eventId });
      sendError(res, 404, 'order_not_found', 'ไม่พบคำสั่งซื้อนี้');
      return;

    case 'amount_mismatch':
      // ยอดไม่ตรงกับที่บันทึกไว้ = payload ถูกแก้ หรือคนละ order — ห้ามอัปเดตเป็น paid
      sendError(res, 409, 'amount_mismatch', 'ยอดชำระไม่ตรงกับคำสั่งซื้อ');
      return;

    default: {
      const exhaustiveCheck: never = result;
      throw new Error(`ยังไม่ได้จัดการ outcome: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    // รายละเอียดของ JSON ที่พังไม่มีประโยชน์ต่อผู้เรียก และ body อาจมีข้อมูลอ่อนไหว
    return undefined;
  }
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function readRequestId(res: Response): string | undefined {
  const value = res.getHeader('X-Request-Id');
  return typeof value === 'string' ? value : undefined;
}
