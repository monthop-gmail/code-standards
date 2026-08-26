'use strict';

const { AppError } = require('../../errors/AppError');

/**
 * Request validation. The legacy route trusted the body completely: it read
 * `items.length` without checking that `items` existed (a missing field threw
 * a TypeError), and passed qty/productId straight into SQL.
 *
 * Validators return clean, typed values; they never mutate the request.
 */

function parsePositiveInt(value, field) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: `${field} must be a positive integer.` };
  }
  return { value: parsed };
}

/**
 * @param {unknown} body
 * @param {{maxItemsPerOrder:number, maxQtyPerLine:number}} limits
 * @returns {{userId:number, items:Array<{productId:number,qty:number}>, couponCode:string|null, email:string|null}}
 */
function validateCreateOrder(body, limits) {
  const errors = [];

  if (body === null || typeof body !== 'object') {
    throw AppError.validation([{ field: 'body', message: 'Request body must be a JSON object.' }]);
  }

  const userId = parsePositiveInt(body.userId, 'userId');
  if (userId.error) errors.push({ field: 'userId', message: userId.error });

  let items = [];
  if (!Array.isArray(body.items) || body.items.length === 0) {
    errors.push({ field: 'items', message: 'items must be a non-empty array.' });
  } else if (body.items.length > limits.maxItemsPerOrder) {
    errors.push({
      field: 'items',
      message: `items must contain at most ${limits.maxItemsPerOrder} entries.`,
    });
  } else {
    items = body.items.map((raw, index) => {
      if (raw === null || typeof raw !== 'object') {
        errors.push({ field: `items[${index}]`, message: 'Each item must be an object.' });
        return null;
      }
      const productId = parsePositiveInt(raw.productId, `items[${index}].productId`);
      const qty = parsePositiveInt(raw.qty, `items[${index}].qty`);

      if (productId.error) errors.push({ field: `items[${index}].productId`, message: productId.error });
      if (qty.error) errors.push({ field: `items[${index}].qty`, message: qty.error });
      else if (qty.value > limits.maxQtyPerLine) {
        errors.push({
          field: `items[${index}].qty`,
          message: `qty must be at most ${limits.maxQtyPerLine}.`,
        });
      }

      if (productId.error || qty.error) return null;
      return { productId: productId.value, qty: qty.value };
    });
  }

  let couponCode = null;
  if (body.coupon !== undefined && body.coupon !== null && body.coupon !== '') {
    if (typeof body.coupon !== 'string' || body.coupon.length > 64) {
      errors.push({ field: 'coupon', message: 'coupon must be a string of at most 64 characters.' });
    } else {
      couponCode = body.coupon.trim();
    }
  }

  let email = null;
  if (body.email !== undefined && body.email !== null && body.email !== '') {
    if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      errors.push({ field: 'email', message: 'email must be a valid email address.' });
    } else {
      email = body.email;
    }
  }

  if (errors.length > 0) throw AppError.validation(errors);

  return { userId: userId.value, items: items.filter(Boolean), couponCode, email };
}

/** @returns {number} a validated order id from the URL path. */
function validateOrderId(rawId) {
  const parsed = parsePositiveInt(rawId, 'id');
  if (parsed.error) {
    throw AppError.badRequest('Order id must be a positive integer.', { field: 'id' });
  }
  return parsed.value;
}

module.exports = { validateCreateOrder, validateOrderId };
