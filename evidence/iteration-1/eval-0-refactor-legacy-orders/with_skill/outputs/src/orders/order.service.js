'use strict';

const { ValidationError, NotFoundError } = require('../errors');
const { priceOrder, toMajorUnits } = require('./pricing');

/**
 * Orchestration ของ order: อ่านข้อมูลที่ต้องใช้ → คิดเงิน → บันทึกใน transaction → แจ้งเตือน
 * ไม่รู้จัก express (ไม่มี req/res) จึง test ได้ด้วย fake repository ล้วน ๆ
 *
 * @param {object} deps
 * @param {import('mysql2/promise').Pool} deps.pool
 * @param {typeof import('./order.repository')} deps.repository
 * @param {{ sendOrderConfirmation: (input: { to: string, orderId: number }) => Promise<void> }} deps.mailer
 * @param {{ info: (msg: string, meta?: object) => void, error: (msg: string, meta?: object) => void }} deps.logger
 */
function createOrderService({ pool, repository, mailer, logger }) {
  /**
   * ราคามาจาก DB เสมอ ไม่เคยรับจาก client — client บอกได้แค่ว่าจะซื้ออะไร จำนวนเท่าไหร่
   *
   * @param {number} userId มาจาก session ที่ authenticate แล้ว ไม่ใช่จาก request body
   * @param {import('./order.validation').CreateOrderInput} input
   * @returns {Promise<{ orderId: number, subtotalMinor: number, couponDiscountMinor: number, shippingMinor: number, totalMinor: number, total: number, lines: import('./pricing').PricedLine[] }>}
   */
  async function createOrder(userId, input) {
    const productIds = input.items.map((item) => item.productId);
    const [products, coupon] = await Promise.all([
      repository.findProductsByIds(pool, productIds),
      input.couponCode ? repository.findCouponByCode(pool, input.couponCode) : Promise.resolve(null),
    ]);

    const productsById = new Map(products.map((product) => [product.id, product]));
    const missingProductIds = productIds.filter((id) => !productsById.has(id));
    if (missingProductIds.length > 0) {
      throw new ValidationError('Some products in the order no longer exist', { missingProductIds });
    }

    // ของเดิมเงียบ ๆ ไม่ลดถ้าคูปองไม่มีจริง ลูกค้าจะเห็นยอดไม่ตรงที่คาดโดยไม่มีคำอธิบาย
    if (input.couponCode && !coupon) {
      throw new ValidationError('Coupon code is not valid', { couponCode: input.couponCode });
    }

    const priced = priceOrder({ items: input.items, productsById, coupon });

    const orderId = await withTransaction(async (connection) => {
      const newOrderId = await repository.insertOrder(connection, {
        userId,
        totalMinor: priced.totalMinor,
      });
      await repository.insertOrderItems(connection, newOrderId, priced.lines);
      return newOrderId;
    });

    logger.info('order.created', { orderId, userId, totalMinor: priced.totalMinor, lineCount: priced.lines.length });

    await sendConfirmationBestEffort(userId, orderId);

    return {
      orderId,
      subtotalMinor: priced.subtotalMinor,
      couponDiscountMinor: priced.couponDiscountMinor,
      shippingMinor: priced.shippingMinor,
      totalMinor: priced.totalMinor,
      total: toMajorUnits(priced.totalMinor),
      lines: priced.lines,
    };
  }

  /**
   * @param {number} orderId
   * @param {number} userId
   * @returns {Promise<{ orderId: number, status: string, total: number, createdAt: Date, items: { productId: number, name: string|null, qty: number, unitPrice: number }[] }>}
   */
  async function getOrder(orderId, userId) {
    const order = await repository.findOrderForUser(pool, orderId, userId);
    // ตอบ 404 ไม่ใช่ 403 สำหรับ order ของคนอื่น — 403 จะบอกใบ้ว่า id นี้มีอยู่จริง
    if (!order) {
      throw new NotFoundError(`Order ${orderId} was not found`, 'ORDER_NOT_FOUND');
    }

    const items = await repository.findOrderItems(pool, orderId);
    return {
      orderId: order.id,
      status: order.status,
      total: Number(order.total),
      createdAt: order.created_at,
      items: items.map((item) => ({
        productId: item.product_id,
        name: item.name,
        qty: item.qty,
        unitPrice: Number(item.unit_price),
      })),
    };
  }

  /**
   * order กับ order_items ต้องสำเร็จหรือล้มพร้อมกัน — ของเดิมถ้า insert แถวที่สองพัง
   * จะเหลือ order ที่ไม่มีสินค้าค้างใน DB
   * @template T
   * @param {(connection: import('mysql2/promise').PoolConnection) => Promise<T>} work
   * @returns {Promise<T>}
   */
  async function withTransaction(work) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch((rollbackError) => {
        logger.error('order.transaction.rollback_failed', { message: rollbackError.message });
      });
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * อีเมลยืนยันคือ dependency รอง — ส่งไม่ได้ไม่ควรทำให้ order ที่ commit แล้วกลายเป็น error
   * แต่ต้อง log พร้อม orderId เพื่อให้ตามส่งซ้ำได้ (ของเดิม `catch (e) {}` เปล่า = หายเงียบ)
   * @param {number} userId
   * @param {number} orderId
   * @returns {Promise<void>}
   */
  async function sendConfirmationBestEffort(userId, orderId) {
    try {
      const email = await repository.findUserEmail(pool, userId);
      if (!email) {
        logger.error('order.confirmation.skipped_no_email', { orderId, userId });
        return;
      }
      await mailer.sendOrderConfirmation({ to: email, orderId });
    } catch (error) {
      logger.error('order.confirmation.failed', {
        orderId,
        userId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { createOrder, getOrder };
}

module.exports = { createOrderService };
