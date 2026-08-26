import pg from 'pg';
import { config } from './config.js';
import { describeError, logger } from './logger.js';

export type DbClient = pg.PoolClient;

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  // กัน query ค้างจนกิน connection ทั้ง pool เวลา DB ช้า
  statement_timeout: 10_000,
});

// idle client ที่ error (DB restart, connection ถูกตัด) จะทำให้ process ตายถ้าไม่ดักไว้
pool.on('error', (error) => {
  logger.error('db_idle_client_error', { error: describeError(error) });
});

/**
 * ครอบงานที่ต้อง "สำเร็จหรือล้มพร้อมกัน" ไว้ใน transaction เดียว
 * ถ้า fn โยน error จะ ROLLBACK แล้วโยน error ตัวเดิมต่อ — ผู้เรียกเป็นคนตัดสินใจว่าจะทำยังไงต่อ
 */
export async function withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let connectionIsBroken = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // rollback ไม่สำเร็จแปลว่า connection เสีย — ต้องทิ้งทิ้งไม่ให้กลับเข้า pool
      // log แยกไว้เพราะเป็นคนละปัญหากับ error ต้นทางที่กำลังจะโยนต่อ
      connectionIsBroken = true;
      logger.error('db_rollback_failed', { error: describeError(rollbackError) });
    }
    throw error;
  } finally {
    client.release(connectionIsBroken);
  }
}
