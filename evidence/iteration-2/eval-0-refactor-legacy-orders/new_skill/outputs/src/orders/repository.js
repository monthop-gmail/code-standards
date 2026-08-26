'use strict';

const { toMinorUnits, toMajorUnits } = require('../money');

/**
 * SQL ทั้งหมดของ order อยู่ที่นี่ที่เดียว — ทุก query เป็น parameterized (`?`)
 * ไม่มีการต่อ string เข้าไปใน SQL แม้แต่จุดเดียว
 *
 * ทุกฟังก์ชันรับ `conn` เข้ามา (จะเป็น pool หรือ connection ใน transaction ก็ได้)
 * เพื่อให้ผู้เรียกเป็นคนตัดสินขอบเขต transaction ไม่ใช่ repository
 *
 * @typedef {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} Db
 */

/**
 * ดึงสินค้าหลายตัวด้วย query เดียว แก้ N+1 ที่เดิมยิงทีละชิ้นในลูป
 * @param {Db} conn
 * @param {number[]} productIds
 * @returns {Promise<Map<number, import('./pricing').PricedProduct>>}
 */
async function findProductsByIds(conn, productIds) {
  if (productIds.length === 0) return new Map();
  const [rows] = await conn.query(
    'SELECT id, name, price, category FROM products WHERE id IN (?)',
    [productIds],
  );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        unitPriceMinor: toMinorUnits(row.price, `product ${row.id} price`),
        categoryId: row.category,
      },
    ]),
  );
}

/**
 * @param {Db} conn
 * @param {string} code
 * @returns {Promise<import('./pricing').Coupon|null>}
 */
async function findCouponByCode(conn, code) {
  const [rows] = await conn.query('SELECT code, type, value FROM coupons WHERE code = ? LIMIT 1', [
    code,
  ]);
  if (rows.length === 0) return null;
  return { code: rows[0].code, type: rows[0].type, value: Number(rows[0].value) };
}

/**
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {{ userId: number, totalMinor: number }} order
 * @returns {Promise<number>} order id ที่สร้าง
 */
async function insertOrder(conn, { userId, totalMinor }) {
  const [result] = await conn.query(
    "INSERT INTO orders (user_id, total, status, created_at) VALUES (?, ?, 'new', NOW())",
    [userId, toMajorUnits(totalMinor)],
  );
  return result.insertId;
}

/**
 * INSERT ทุกบรรทัดในคำสั่งเดียว แทนการวน await ทีละแถว
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {number} orderId
 * @param {import('./pricing').QuoteLine[]} lines
 * @returns {Promise<void>}
 */
async function insertOrderItems(conn, orderId, lines) {
  if (lines.length === 0) return;
  const values = lines.map((line) => [
    orderId,
    line.productId,
    toMajorUnits(line.unitPriceMinor),
    line.qty,
  ]);
  await conn.query(
    'INSERT INTO order_items (order_id, product_id, unit_price, qty) VALUES ?',
    [values],
  );
}

/**
 * ดึง order เฉพาะที่เป็นของ user คนนี้
 *
 * เงื่อนไข user_id อยู่ใน SQL โดยตั้งใจ ไม่ใช่ไปเช็คในโค้ดทีหลัง — order ของคนอื่น
 * จึงให้ผลเหมือนกับ order ที่ไม่มีอยู่จริง ไม่รั่วข้อมูลว่า id ไหนมีคนใช้แล้ว
 *
 * @param {Db} conn
 * @param {{ orderId: number, userId: number }} args
 * @returns {Promise<{ id: number, user_id: number, total: string|number, status: string, created_at: Date }|null>}
 */
async function findOrderForUser(conn, { orderId, userId }) {
  const [rows] = await conn.query(
    'SELECT id, user_id, total, status, created_at FROM orders WHERE id = ? AND user_id = ? LIMIT 1',
    [orderId, userId],
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * บรรทัดสินค้าพร้อมชื่อสินค้า ด้วย query เดียว (LEFT JOIN เพื่อให้บรรทัดไม่หายไป
 * ถ้าสินค้าถูกลบทีหลัง — เดิมโค้ดพังเป็น 500 เพราะไปอ่าน p[0].name ของ array ว่าง)
 * @param {Db} conn
 * @param {number} orderId
 * @returns {Promise<{ name: string|null, qty: number, unit: string|number }[]>}
 */
async function findOrderItems(conn, orderId) {
  const [rows] = await conn.query(
    `SELECT p.name AS name, oi.qty AS qty, oi.unit_price AS unit
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?`,
    [orderId],
  );
  return rows.map((row) => ({ name: row.name, qty: row.qty, unit: row.unit }));
}

module.exports = {
  findProductsByIds,
  findCouponByCode,
  insertOrder,
  insertOrderItems,
  findOrderForUser,
  findOrderItems,
};
