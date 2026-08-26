'use strict';

const { AppError } = require('../errors');

/**
 * ตรวจ input ที่ข้ามขอบเขต trust (HTTP body / path param) ให้จบที่ชั้นเดียว
 * แล้วส่ง object ที่ typed แล้วเข้าไปข้างใน — ชั้นในจึงไม่ต้องเดาว่าค่ามาถูกชนิดไหม
 */

const MAX_ITEMS_PER_ORDER = 100;
const MAX_QTY_PER_ITEM = 1_000;
const MAX_COUPON_CODE_LENGTH = 64;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @typedef {object} CreateOrderInput
 * @property {{ productId: number, qty: number }[]} items
 * @property {string|null} couponCode
 * @property {string|null} email
 */

/**
 * แปลง body ของ POST /orders เป็น input ที่เชื่อถือได้ หรือโยน AppError 400 พร้อมรายการ field ที่ผิด
 *
 * หมายเหตุความปลอดภัย: `userId` ถูกตัดออกจาก body โดยตั้งใจ — ตัวตนผู้สั่งต้องมาจาก
 * session ฝั่ง server เท่านั้น ไม่ใช่จากสิ่งที่ client พิมพ์มา (ดู requireUserId ใน routes.js)
 *
 * @param {unknown} body
 * @returns {CreateOrderInput}
 */
function parseCreateOrderInput(body) {
  /** @type {string[]} */
  const errors = [];

  if (!isPlainObject(body)) {
    throw new AppError('VALIDATION_ERROR', 'request body must be a JSON object', 400);
  }

  const rawItems = body.items;
  /** @type {{ productId: number, qty: number }[]} */
  const items = [];

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    errors.push('items: must be a non-empty array');
  } else if (rawItems.length > MAX_ITEMS_PER_ORDER) {
    errors.push(`items: must contain at most ${MAX_ITEMS_PER_ORDER} entries`);
  } else {
    rawItems.forEach((rawItem, index) => {
      if (!isPlainObject(rawItem)) {
        errors.push(`items[${index}]: must be an object`);
        return;
      }
      const productId = asPositiveInt(rawItem.productId);
      const qty = asPositiveInt(rawItem.qty);
      if (productId === null) {
        errors.push(`items[${index}].productId: must be a positive integer`);
      }
      if (qty === null || qty > MAX_QTY_PER_ITEM) {
        errors.push(`items[${index}].qty: must be an integer between 1 and ${MAX_QTY_PER_ITEM}`);
      }
      if (productId !== null && qty !== null && qty <= MAX_QTY_PER_ITEM) {
        items.push({ productId, qty });
      }
    });
  }

  let couponCode = null;
  if (body.coupon !== undefined && body.coupon !== null && body.coupon !== '') {
    if (typeof body.coupon !== 'string' || body.coupon.trim().length === 0) {
      errors.push('coupon: must be a non-empty string when provided');
    } else if (body.coupon.trim().length > MAX_COUPON_CODE_LENGTH) {
      errors.push(`coupon: must be at most ${MAX_COUPON_CODE_LENGTH} characters`);
    } else {
      couponCode = body.coupon.trim();
    }
  }

  let email = null;
  if (body.email !== undefined && body.email !== null && body.email !== '') {
    if (typeof body.email !== 'string' || !isPlausibleEmail(body.email.trim())) {
      errors.push('email: must be a valid email address when provided');
    } else {
      email = body.email.trim();
    }
  }

  if (errors.length > 0) {
    throw new AppError('VALIDATION_ERROR', 'invalid order payload', 400, { fields: errors });
  }

  return { items, couponCode, email };
}

/**
 * แปลง path param ให้เป็น id ที่ใช้ query ได้ หรือโยน 400
 * @param {unknown} raw
 * @param {string} field
 * @returns {number}
 */
function parseIdParam(raw, field) {
  const id = asPositiveInt(raw);
  if (id === null) {
    throw new AppError('VALIDATION_ERROR', `${field} must be a positive integer`, 400);
  }
  return id;
}

/**
 * รับได้ทั้ง number และ string ตัวเลข (path param มาเป็น string เสมอ)
 * ปฏิเสธ 0, ค่าติดลบ, ทศนิยม, NaN, Infinity และค่าที่เกิน safe integer
 * @param {unknown} raw
 * @returns {number|null}
 */
function asPositiveInt(raw) {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const parsed = Number(raw.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * เช็คแค่ว่ารูปแบบพอเป็นไปได้ ไม่ได้พิสูจน์ว่ามีอยู่จริง — การยืนยันตัวจริงคือการส่งเมลแล้วถึง
 * @param {string} value
 * @returns {boolean}
 */
function isPlausibleEmail(value) {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

module.exports = { parseCreateOrderInput, parseIdParam, asPositiveInt };
