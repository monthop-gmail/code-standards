'use strict';

const { toMajorUnits } = require('./pricing');

/**
 * SQL ทั้งหมดของ feature "order" อยู่ในไฟล์นี้ไฟล์เดียว
 *
 * ทำไมไม่แตกเป็น product/coupon/order repo แยกไฟล์: ทุก query ในนี้เปลี่ยนด้วยเหตุผลเดียวกัน
 * (schema ของ order flow เปลี่ยน) และแต่ละไฟล์จะเหลือ 15 บรรทัด — การเปิด 4 ไฟล์เพื่ออ่าน
 * flow เดียวแพงกว่าประโยชน์ที่ได้ ถ้าวันหนึ่ง product มี use case นอก order เมื่อไหร่ ค่อยแยก
 *
 * ทุกฟังก์ชันรับ `executor` (pool หรือ connection ที่อยู่ใน transaction) เป็น argument แรก
 * เพื่อให้ service คุมขอบเขต transaction ได้ โดย repository ไม่ต้องรู้เรื่อง transaction
 *
 * ทุก query เป็น parameterized ทั้งหมด — ของเดิมต่อ string ทำให้ SQL injection ได้ทุกจุด
 * @typedef {import('mysql2/promise').Pool|import('mysql2/promise').PoolConnection} Executor
 */

/**
 * โหลดสินค้าทั้งตะกร้าด้วย query เดียว (ของเดิมยิงทีละชิ้นในลูป = N+1)
 * @param {Executor} executor
 * @param {number[]} productIds
 * @returns {Promise<import('./pricing').ProductRow[]>}
 */
async function findProductsByIds(executor, productIds) {
  if (productIds.length === 0) return [];
  // placeholder สร้างจาก "จำนวน" ของ id ไม่ใช่จากค่า — ค่าทั้งหมดยังผูกเป็น parameter
  const placeholders = productIds.map(() => '?').join(', ');
  const [rows] = await executor.query(
    `SELECT id, name, price, category FROM products WHERE id IN (${placeholders})`,
    productIds
  );
  return rows;
}

/**
 * @param {Executor} executor
 * @param {string} code
 * @returns {Promise<import('./pricing').CouponRow|null>}
 */
async function findCouponByCode(executor, code) {
  const [rows] = await executor.query(
    'SELECT code, type, value FROM coupons WHERE code = ? LIMIT 1',
    [code]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * ดึงอีเมลจากบัญชีผู้ใช้ ไม่ใช่จาก request body — กันไม่ให้ endpoint นี้ถูกใช้
 * ยิงอีเมลไปหาที่อยู่ใดก็ได้ที่ผู้เรียกใส่มา
 * @param {Executor} executor
 * @param {number} userId
 * @returns {Promise<string|null>}
 */
async function findUserEmail(executor, userId) {
  const [rows] = await executor.query('SELECT email FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows.length > 0 ? rows[0].email : null;
}

/**
 * @param {Executor} executor ต้องเป็น connection ที่เปิด transaction อยู่
 * @param {{ userId: number, totalMinor: number }} order
 * @returns {Promise<number>} order id ที่สร้างใหม่
 */
async function insertOrder(executor, { userId, totalMinor }) {
  const [result] = await executor.query(
    'INSERT INTO orders (user_id, total, status, created_at) VALUES (?, ?, ?, NOW())',
    [userId, toMajorUnits(totalMinor), 'new']
  );
  return result.insertId;
}

/**
 * insert ทีเดียวทุกบรรทัด (ของเดิม await ในลูป = round-trip ต่อสินค้าหนึ่งชิ้น)
 * @param {Executor} executor
 * @param {number} orderId
 * @param {import('./pricing').PricedLine[]} lines
 * @returns {Promise<void>}
 */
async function insertOrderItems(executor, orderId, lines) {
  if (lines.length === 0) return;
  const values = lines.map((line) => [orderId, line.productId, toMajorUnits(line.unitPriceMinor), line.qty]);
  await executor.query(
    'INSERT INTO order_items (order_id, product_id, unit_price, qty) VALUES ?',
    [values]
  );
}

/**
 * เงื่อนไข user_id อยู่ใน WHERE ตั้งแต่แรก — ป้องกัน IDOR โดยไม่ต้องพึ่งการเช็คในโค้ด
 * @param {Executor} executor
 * @param {number} orderId
 * @param {number} userId
 * @returns {Promise<{ id: number, user_id: number, total: string, status: string, created_at: Date }|null>}
 */
async function findOrderForUser(executor, orderId, userId) {
  const [rows] = await executor.query(
    'SELECT id, user_id, total, status, created_at FROM orders WHERE id = ? AND user_id = ? LIMIT 1',
    [orderId, userId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * JOIN ชื่อสินค้ามาในรอบเดียว (ของเดิมยิง SELECT name ต่อหนึ่งบรรทัดของ order)
 * @param {Executor} executor
 * @param {number} orderId
 * @returns {Promise<{ product_id: number, name: string|null, unit_price: string, qty: number }[]>}
 */
async function findOrderItems(executor, orderId) {
  const [rows] = await executor.query(
    `SELECT oi.product_id, p.name, oi.unit_price, oi.qty
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?
      ORDER BY oi.id`,
    [orderId]
  );
  return rows;
}

module.exports = {
  findProductsByIds,
  findCouponByCode,
  findUserEmail,
  insertOrder,
  insertOrderItems,
  findOrderForUser,
  findOrderItems,
};
