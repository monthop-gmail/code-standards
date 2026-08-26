import type { DbClient } from '../db.js';
import { pool } from '../db.js';

export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'refunded' | 'failed';

export interface Order {
  readonly id: string;
  readonly customerEmail: string;
  readonly customerName: string;
  /** จำนวนเงินหน่วยย่อย (สตางค์) — integer เสมอ ไม่ใช้ float กับเงิน */
  readonly amountMinorUnits: number;
  /** ISO 4217 ตัวใหญ่ เช่น THB */
  readonly currency: string;
  readonly status: OrderStatus;
}

export interface MarkOrderPaidInput {
  readonly orderId: string;
  readonly paymentReference: string;
  readonly paidAt: Date;
}

/**
 * repository ที่ผูกกับ transaction หนึ่ง ๆ
 * service ใช้ interface นี้ ไม่รู้จัก pg เลย → เทสต์ business logic ได้โดยไม่ต้องมี DB
 */
export interface OrderRepository {
  /** @returns true ถ้าเป็น event ใหม่, false ถ้าเคยรับ event id นี้ไปแล้ว */
  recordWebhookEvent(eventId: string, eventType: string): Promise<boolean>;
  /** ล็อกแถว order ไว้จนจบ transaction เพื่อกัน webhook สองใบชนกัน */
  findOrderForUpdate(orderId: string): Promise<Order | null>;
  /** @returns true ถ้าอัปเดตจริง, false ถ้าสถานะไม่ใช่ pending แล้ว (มีคนอื่นอัปเดตไปก่อน) */
  markOrderPaid(input: MarkOrderPaidInput): Promise<boolean>;
}

interface OrderRow {
  readonly id: string;
  readonly customer_email: string;
  readonly customer_name: string;
  /** BIGINT ถูก cast เป็น text ใน SQL เพื่อไม่ให้ driver ตีความเป็น float */
  readonly amount_minor_units: string;
  readonly currency: string;
  readonly status: OrderStatus;
}

export function createOrderRepository(client: DbClient): OrderRepository {
  return {
    async recordWebhookEvent(eventId: string, eventType: string): Promise<boolean> {
      const result = await client.query(
        `INSERT INTO payment_webhook_events (event_id, event_type)
         VALUES ($1, $2)
         ON CONFLICT (event_id) DO NOTHING`,
        [eventId, eventType],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async findOrderForUpdate(orderId: string): Promise<Order | null> {
      const result = await client.query<OrderRow>(
        `SELECT id,
                customer_email,
                customer_name,
                amount_minor_units::text AS amount_minor_units,
                currency,
                status
           FROM orders
          WHERE id = $1
          FOR UPDATE`,
        [orderId],
      );
      const row = result.rows[0];
      return row === undefined ? null : toOrder(row);
    },

    async markOrderPaid({ orderId, paymentReference, paidAt }: MarkOrderPaidInput): Promise<boolean> {
      // เงื่อนไข status = 'pending' ทำให้ update นี้ปลอดภัยต่อการยิงซ้ำ
      // และไม่ไปทับ order ที่ถูก cancel/refund ไปแล้ว
      const result = await client.query(
        `UPDATE orders
            SET status = 'paid',
                paid_at = $2,
                payment_reference = $3,
                updated_at = now()
          WHERE id = $1
            AND status = 'pending'`,
        [orderId, paidAt, paymentReference],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}

/**
 * บันทึกว่าส่งอีเมลยืนยันแล้ว — ทำนอก transaction ของการตัดเงินโดยตั้งใจ
 * เพราะ order ถูก commit ว่า paid ไปแล้ว การส่งอีเมลล้มต้องไม่ทำให้สถานะเงินหาย
 * แถวที่ paid แต่ confirmation_email_sent_at IS NULL คือคิวให้ job ตามเก็บทีหลัง
 */
export async function markConfirmationEmailSent(orderId: string, sentAt: Date): Promise<void> {
  await pool.query(
    `UPDATE orders
        SET confirmation_email_sent_at = $2,
            updated_at = now()
      WHERE id = $1`,
    [orderId, sentAt],
  );
}

function toOrder(row: OrderRow): Order {
  const amountMinorUnits = Number(row.amount_minor_units);
  if (!Number.isSafeInteger(amountMinorUnits)) {
    throw new Error(`order ${row.id} มี amount_minor_units ที่แปลงเป็น integer ไม่ได้`);
  }
  return {
    id: row.id,
    customerEmail: row.customer_email,
    customerName: row.customer_name,
    amountMinorUnits,
    currency: row.currency.toUpperCase(),
    status: row.status,
  };
}
