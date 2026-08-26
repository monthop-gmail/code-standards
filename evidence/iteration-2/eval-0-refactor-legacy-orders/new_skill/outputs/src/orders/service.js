'use strict';

const { withTransaction, pool } = require('../db');
const { AppError } = require('../errors');
const { sendOrderConfirmation } = require('../mailer');
const repository = require('./repository');
const { quoteOrder } = require('./pricing');

/**
 * Use case ของ order — ลำดับการทำงานอยู่ที่นี่ ส่วนสูตรราคาอยู่ใน pricing.js
 * และ SQL อยู่ใน repository.js
 */

/**
 * สร้างคำสั่งซื้อจากสินค้าที่ลูกค้าเลือก
 *
 * ราคาทุกบาทถูกอ่านจาก DB ฝั่ง server เสมอ ไม่รับราคาหรือส่วนลดที่ client ส่งมา
 * การอ่านสินค้า/คูปองและการเขียนอยู่ใน transaction เดียวกัน เพื่อไม่ให้ราคาที่ใช้คำนวณ
 * เปลี่ยนไประหว่างที่กำลังบันทึก และไม่ให้เหลือ order ที่มีรายการไม่ครบเมื่อมีอะไรพัง
 *
 * @param {{ userId: number, input: import('./validation').CreateOrderInput }} args
 * @returns {Promise<{ orderId: number, quote: import('./pricing').Quote }>}
 * @throws {AppError} 422 เมื่อสินค้าหรือคูปองที่อ้างถึงไม่มีอยู่จริง
 */
async function createOrder({ userId, input }) {
  const productIds = [...new Set(input.items.map((item) => item.productId))];

  const { orderId, quote } = await withTransaction(async (conn) => {
    const products = await repository.findProductsByIds(conn, productIds);

    const unknownProductIds = productIds.filter((id) => !products.has(id));
    if (unknownProductIds.length > 0) {
      throw new AppError('UNKNOWN_PRODUCT', 'some products do not exist', 422, {
        productIds: unknownProductIds,
      });
    }

    const coupon = input.couponCode
      ? await repository.findCouponByCode(conn, input.couponCode)
      : null;
    if (input.couponCode && !coupon) {
      throw new AppError('UNKNOWN_COUPON', 'coupon code is not valid', 422, {
        coupon: input.couponCode,
      });
    }

    const computedQuote = quoteOrder({ items: input.items, products, coupon });
    const newOrderId = await repository.insertOrder(conn, {
      userId,
      totalMinor: computedQuote.totalMinor,
    });
    await repository.insertOrderItems(conn, newOrderId, computedQuote.lines);

    return { orderId: newOrderId, quote: computedQuote };
  });

  console.info(
    JSON.stringify({
      event: 'order_created',
      orderId,
      userId,
      itemCount: quote.lines.length,
      totalMinor: quote.totalMinor,
    }),
  );

  if (input.email) {
    await sendOrderConfirmation({ to: input.email, orderId });
  }

  return { orderId, quote };
}

/**
 * อ่านคำสั่งซื้อของผู้ใช้คนนั้น พร้อมรายการสินค้า
 *
 * @param {{ orderId: number, userId: number }} args
 * @returns {Promise<{ id: number, user_id: number, total: string|number, status: string, created_at: Date, items: { name: string|null, qty: number, unit: string|number }[] }>}
 * @throws {AppError} 404 เมื่อไม่พบ หรือ order นั้นไม่ใช่ของผู้ใช้คนนี้
 */
async function getOrderForUser({ orderId, userId }) {
  const order = await repository.findOrderForUser(pool, { orderId, userId });
  if (!order) {
    throw new AppError('ORDER_NOT_FOUND', 'order not found', 404);
  }
  const items = await repository.findOrderItems(pool, orderId);
  return { ...order, items };
}

module.exports = { createOrder, getOrderForUser };
