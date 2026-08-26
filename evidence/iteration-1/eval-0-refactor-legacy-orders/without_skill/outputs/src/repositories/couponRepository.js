'use strict';

/**
 * Coupon lookups.
 *
 * The legacy query interpolated the raw `coupon` string into SQL, which was
 * both an injection vector and a correctness problem: it applied ANY row that
 * matched the code, ignoring whether the coupon was active or expired.
 */
class CouponRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Look up a coupon that is currently redeemable.
   * Expiry/active filtering happens in SQL so it cannot be forgotten by a caller.
   *
   * @param {string} code
   * @returns {Promise<{id:number, code:string, type:string, value:number}|null>}
   */
  async findRedeemableByCode(code) {
    const [rows] = await this.db.query(
      `SELECT id, code, type, value
         FROM coupons
        WHERE code = ?
          AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 1`,
      [code],
    );
    return rows[0] ?? null;
  }
}

module.exports = { CouponRepository };
