'use strict';

/**
 * Transaction helper.
 *
 * Kept free of any driver import: it only depends on the connection contract
 * (beginTransaction / commit / rollback / release). That keeps the service
 * layer independent of mysql2 and lets tests drive it with a plain fake.
 */

/**
 * Run `work` inside a transaction, committing on success and rolling back on
 * any throw. The legacy code inserted the order row and then each order_item
 * as separate autocommitted statements: a failure midway left a paid-for
 * order in the database with only some of its items.
 *
 * @template T
 * @param {{getConnection: () => Promise<any>}} pool
 * @param {(connection: any) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      /* a rollback failure must not mask the original error */
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { withTransaction };
