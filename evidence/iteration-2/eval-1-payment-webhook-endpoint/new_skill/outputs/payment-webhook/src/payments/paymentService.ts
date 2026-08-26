import type { Logger } from '../logger.js';
import { describeError, maskEmail } from '../logger.js';
import type { Order, OrderRepository, OrderStatus } from './orderRepository.js';

export interface PaymentSucceededEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly orderId: string;
  readonly paymentReference: string;
  /** หน่วยย่อย (สตางค์) ตามที่ gateway แจ้งมา — ต้องตรงกับยอดใน DB เท่านั้น */
  readonly amountMinorUnits: number;
  readonly currency: string;
}

export type ProcessPaymentResult =
  | { readonly outcome: 'processed'; readonly order: Order; readonly confirmationEmailSent: boolean }
  | { readonly outcome: 'duplicate_event' }
  | { readonly outcome: 'order_already_paid' }
  | { readonly outcome: 'order_not_payable'; readonly status: OrderStatus }
  | { readonly outcome: 'order_not_found' }
  | { readonly outcome: 'amount_mismatch' };

export interface PaymentServiceDeps {
  /** เปิด transaction แล้วส่ง repository ที่ผูกกับ transaction นั้นเข้า fn */
  runInTransaction<T>(fn: (repository: OrderRepository) => Promise<T>): Promise<T>;
  sendOrderConfirmationEmail(order: Order, paymentReference: string): Promise<void>;
  markConfirmationEmailSent(orderId: string, sentAt: Date): Promise<void>;
  readonly logger: Logger;
  /** แยกออกมาเพื่อให้เทสต์คุมเวลาได้ */
  now?(): Date;
}

/**
 * บังคับให้ transaction rollback โดยที่ยังส่งผลลัพธ์กลับไปให้ผู้เรียกได้
 *
 * ใช้กับกรณีที่ "ยังไม่ควรถือว่า event นี้ถูกประมวลผลแล้ว" — ถ้าปล่อยให้ commit
 * แถวใน payment_webhook_events จะทำให้ retry ของ gateway ถูกมองเป็น duplicate
 * แล้ว order จะไม่มีวันถูกอัปเดตเลย
 */
class RollbackSignal extends Error {
  readonly result: ProcessPaymentResult;

  constructor(result: ProcessPaymentResult) {
    super('rollback requested by payment service');
    this.name = 'RollbackSignal';
    this.result = result;
  }
}

/**
 * ประมวลผล event "จ่ายเงินสำเร็จ" จาก payment gateway
 *
 * คุณสมบัติที่ต้องคงไว้เสมอ:
 * - idempotent: gateway ยิงซ้ำกี่ครั้ง order ก็ถูกอัปเดตครั้งเดียว และอีเมลออกใบเดียว
 * - ไม่เชื่อยอดเงินจาก payload: ต้องตรงกับยอดใน DB ไม่งั้นถือว่าโดนปลอม
 * - อีเมลส่งหลัง commit: อีเมลล้มไม่ทำให้สถานะการจ่ายเงินหาย
 *
 * ผู้เรียก (HTTP layer) เป็นคนแปลง outcome เป็น status code
 */
export async function processPaymentSucceeded(
  deps: PaymentServiceDeps,
  event: PaymentSucceededEvent,
): Promise<ProcessPaymentResult> {
  const now = deps.now ?? ((): Date => new Date());

  let result: ProcessPaymentResult;
  try {
    result = await deps.runInTransaction(async (repository) => {
      const isNewEvent = await repository.recordWebhookEvent(event.eventId, event.eventType);
      if (!isNewEvent) {
        return { outcome: 'duplicate_event' } as const;
      }

      const order = await repository.findOrderForUpdate(event.orderId);
      if (order === null) {
        // อาจเป็น race (webhook มาถึงก่อน order commit) — rollback เพื่อให้ retry ยังมีโอกาสสำเร็จ
        throw new RollbackSignal({ outcome: 'order_not_found' });
      }

      if (order.status !== 'pending') {
        return order.status === 'paid'
          ? ({ outcome: 'order_already_paid' } as const)
          : ({ outcome: 'order_not_payable', status: order.status } as const);
      }

      if (order.amountMinorUnits !== event.amountMinorUnits || order.currency !== event.currency) {
        deps.logger.error('payment_amount_mismatch', {
          orderId: order.id,
          expectedAmountMinorUnits: order.amountMinorUnits,
          expectedCurrency: order.currency,
          receivedAmountMinorUnits: event.amountMinorUnits,
          receivedCurrency: event.currency,
          eventId: event.eventId,
        });
        throw new RollbackSignal({ outcome: 'amount_mismatch' });
      }

      const updated = await repository.markOrderPaid({
        orderId: order.id,
        paymentReference: event.paymentReference,
        paidAt: now(),
      });
      if (!updated) {
        // แพ้ race กับ transaction อื่นที่อัปเดตไปก่อน — ถือว่าจ่ายแล้ว ไม่ส่งอีเมลซ้ำ
        return { outcome: 'order_already_paid' } as const;
      }

      return { outcome: 'processed', order, confirmationEmailSent: false } as const;
    });
  } catch (error) {
    if (error instanceof RollbackSignal) return error.result;
    throw error;
  }

  if (result.outcome !== 'processed') {
    return result;
  }

  const { order } = result;
  deps.logger.info('order_marked_paid', {
    orderId: order.id,
    eventId: event.eventId,
    amountMinorUnits: order.amountMinorUnits,
    currency: order.currency,
  });

  const confirmationEmailSent = await sendConfirmationEmail(deps, order, event);
  return { outcome: 'processed', order, confirmationEmailSent };
}

/**
 * ส่งอีเมลยืนยันแบบ "ล้มได้" โดยตั้งใจ
 *
 * order ถูก commit เป็น paid ไปแล้ว การตอบ error กลับไปหา gateway จะทำให้มัน retry
 * แล้ว retry นั้นจะถูกกันด้วย idempotency อยู่ดี → อีเมลไม่ถูกส่งซ้ำและไม่ได้ช่วยอะไร
 * จึงเลือก log ให้ดังพอจะตั้ง alert ได้ แล้วปล่อยให้แถวที่ confirmation_email_sent_at IS NULL
 * เป็นคิวของ job ที่ตามส่งทีหลัง
 */
async function sendConfirmationEmail(
  deps: PaymentServiceDeps,
  order: Order,
  event: PaymentSucceededEvent,
): Promise<boolean> {
  const now = deps.now ?? ((): Date => new Date());
  try {
    await deps.sendOrderConfirmationEmail(order, event.paymentReference);
    await deps.markConfirmationEmailSent(order.id, now());
    deps.logger.info('order_confirmation_email_sent', {
      orderId: order.id,
      recipient: maskEmail(order.customerEmail),
    });
    return true;
  } catch (error) {
    deps.logger.error('order_confirmation_email_failed', {
      orderId: order.id,
      recipient: maskEmail(order.customerEmail),
      error: describeError(error),
    });
    return false;
  }
}
