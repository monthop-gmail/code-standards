'use strict';

const mysql = require('mysql2/promise');

/**
 * Connection pool ตัวเดียวของกระบวนการ — ค่าทั้งหมดมาจาก environment
 *
 * credential เดิมถูก hardcode ไว้ในไฟล์ route (host/user/password ของ production)
 * ทุกค่าที่หลุดไปแล้วต้อง rotate ไม่ใช่แค่ลบออกจากโค้ด เพราะยังอยู่ใน git history
 */

/**
 * อ่าน env ที่ขาดไม่ได้ และพังตั้งแต่ตอน boot ถ้าไม่มี
 * ดีกว่าปล่อยให้ pool ต่อไม่ติดตอน request แรกของลูกค้าจริง
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}

const pool = mysql.createPool({
  host: requireEnv('DB_HOST'),
  port: Number(process.env.DB_PORT ?? 3306),
  user: requireEnv('DB_USER'),
  password: requireEnv('DB_PASSWORD'),
  database: requireEnv('DB_NAME'),
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE ?? 10),
  timezone: 'Z',
});

/**
 * รัน callback ใน transaction เดียว: commit เมื่อสำเร็จ, rollback เมื่อ throw,
 * และคืน connection เข้า pool เสมอ
 *
 * มีไว้เพราะการสร้าง order คือหลาย INSERT ที่ต้องสำเร็จหรือล้มพร้อมกัน — โค้ดเดิม
 * insert แถว orders ก่อนแล้วค่อยวน insert order_items ทีละแถวนอก transaction
 * ถ้าแถวกลางพัง จะเหลือ order ที่มีของไม่ครบค้างใน production
 *
 * @template T
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<T>} run
 * @returns {Promise<T>}
 */
async function withTransaction(run) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await run(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { pool, withTransaction };
