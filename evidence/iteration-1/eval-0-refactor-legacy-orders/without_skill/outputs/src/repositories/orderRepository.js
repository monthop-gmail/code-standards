'use strict';

/**
 * Order persistence. All amounts are stored/read as integer minor units at
 * the domain boundary; the repository speaks the database's column types.
 */
class OrderRepository {
  constructor(db) {
    this.db = db;
  }

  /** Bind this repository to a transaction connection. */
  withConnection(connection) {
    return new OrderRepository(connection);
  }

  /**
   * @param {{userId:number, totalMinor:number, status:string}} order
   * @returns {Promise<number>} the new order id
   */
  async createOrder({ userId, totalMinor, status }) {
    const [result] = await this.db.query(
      'INSERT INTO orders (user_id, total, status, created_at) VALUES (?, ?, ?, NOW())',
      [userId, totalMinor / 100, status],
    );
    return result.insertId;
  }

  /**
   * Insert all order lines in a single multi-row INSERT rather than one
   * round-trip per line.
   *
   * @param {number} orderId
   * @param {Array<{productId:number, unitPrice:number, qty:number}>} lines
   */
  async createOrderItems(orderId, lines) {
    if (lines.length === 0) return;

    const values = lines.map((line) => [orderId, line.productId, line.unitPrice / 100, line.qty]);
    await this.db.query(
      'INSERT INTO order_items (order_id, product_id, unit_price, qty) VALUES ?',
      [values],
    );
  }

  /** @returns {Promise<object|null>} */
  async findById(orderId) {
    const [rows] = await this.db.query(
      'SELECT id, user_id, total, status, created_at FROM orders WHERE id = ? LIMIT 1',
      [orderId],
    );
    return rows[0] ?? null;
  }

  /** @returns {Promise<Array<object>>} */
  async findItemsByOrderId(orderId) {
    const [rows] = await this.db.query(
      'SELECT product_id, unit_price, qty FROM order_items WHERE order_id = ?',
      [orderId],
    );
    return rows;
  }
}

module.exports = { OrderRepository };
