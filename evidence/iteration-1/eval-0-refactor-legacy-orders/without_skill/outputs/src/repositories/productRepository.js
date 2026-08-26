'use strict';

/**
 * Product reads. Every query is parameterised — the legacy version built
 * SQL by concatenating `items[i].productId` straight from the request body,
 * so `{"productId": "1 UNION SELECT ..."}` was a live SQL injection.
 */
class ProductRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Fetch many products in ONE query, keyed by id.
   * The legacy loop issued a query per cart item (classic N+1).
   *
   * @param {number[]} ids
   * @returns {Promise<Map<number, object>>}
   */
  async findByIds(ids) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();

    // `?` with an array expands to a safe, escaped IN (...) list.
    const [rows] = await this.db.query(
      'SELECT id, name, price, category FROM products WHERE id IN (?)',
      [unique],
    );
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Names for a set of product ids, keyed by id (used when rendering an order). */
  async findNamesByIds(ids) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();

    const [rows] = await this.db.query('SELECT id, name FROM products WHERE id IN (?)', [unique]);
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}

module.exports = { ProductRepository };
