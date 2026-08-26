'use strict';

const { ValidationError } = require('../errors');

/**
 * ตรวจ input ที่ข้ามขอบเขต trust (HTTP body / path param) ให้จบที่นี่ที่เดียว
 * แล้วส่ง object ที่ type แน่นอนเข้าไปข้างใน — layer ที่ลึกกว่านี้ไม่ต้องเช็คซ้ำ
 *
 * ไม่ได้ใช้ zod เพื่อไม่เพิ่ม dependency ให้ PR refactor; ถ้าวันหนึ่ง repo รับ zod แล้ว
 * ไฟล์นี้แทนที่ได้ทั้งไฟล์โดยไม่กระทบ caller เพราะ output shape เดียวกัน
 */

const MAX_ITEMS_PER_ORDER = 50;
const MAX_QTY_PER_ITEM = 100;
const MAX_COUPON_CODE_LENGTH = 64;
const COUPON_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * @typedef {object} CreateOrderInput
 * @property {{ productId: number, qty: number }[]} items
 * @property {string|null} couponCode
 */

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{ min?: number, max?: number }} [bounds]
 * @returns {number}
 */
function parsePositiveInteger(value, field, bounds = {}) {
  const { min = 1, max = Number.MAX_SAFE_INTEGER } = bounds;
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(`${field} must be an integer between ${min} and ${max}`, { field, value });
  }
  return parsed;
}

/**
 * @param {unknown} body req.body ที่ยังไม่เชื่อถือ
 * @returns {CreateOrderInput}
 */
function validateCreateOrderPayload(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }

  const { items, coupon } = /** @type {Record<string, unknown>} */ (body);

  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items must be a non-empty array', { field: 'items' });
  }
  if (items.length > MAX_ITEMS_PER_ORDER) {
    throw new ValidationError(`items cannot contain more than ${MAX_ITEMS_PER_ORDER} entries`, {
      field: 'items',
      max: MAX_ITEMS_PER_ORDER,
    });
  }

  const seenProductIds = new Set();
  const parsedItems = items.map((rawItem, index) => {
    if (typeof rawItem !== 'object' || rawItem === null) {
      throw new ValidationError(`items[${index}] must be an object`, { field: `items[${index}]` });
    }
    const item = /** @type {Record<string, unknown>} */ (rawItem);
    const productId = parsePositiveInteger(item.productId, `items[${index}].productId`);
    const qty = parsePositiveInteger(item.qty, `items[${index}].qty`, { max: MAX_QTY_PER_ITEM });

    if (seenProductIds.has(productId)) {
      throw new ValidationError(`Product ${productId} appears more than once; merge the quantities`, {
        field: `items[${index}].productId`,
        productId,
      });
    }
    seenProductIds.add(productId);

    return { productId, qty };
  });

  return { items: parsedItems, couponCode: parseCouponCode(coupon) };
}

/**
 * @param {unknown} coupon
 * @returns {string|null}
 */
function parseCouponCode(coupon) {
  if (coupon === undefined || coupon === null || coupon === '') return null;
  if (typeof coupon !== 'string') {
    throw new ValidationError('coupon must be a string', { field: 'coupon' });
  }
  const code = coupon.trim();
  if (code.length === 0) return null;
  if (code.length > MAX_COUPON_CODE_LENGTH || !COUPON_CODE_PATTERN.test(code)) {
    throw new ValidationError('coupon contains invalid characters', { field: 'coupon' });
  }
  return code;
}

/**
 * @param {unknown} rawId ค่าจาก req.params.id ซึ่งเป็น string เสมอ
 * @returns {number}
 */
function validateOrderId(rawId) {
  return parsePositiveInteger(rawId, 'orderId');
}

module.exports = {
  validateCreateOrderPayload,
  validateOrderId,
  parseCouponCode,
  MAX_ITEMS_PER_ORDER,
  MAX_QTY_PER_ITEM,
};
