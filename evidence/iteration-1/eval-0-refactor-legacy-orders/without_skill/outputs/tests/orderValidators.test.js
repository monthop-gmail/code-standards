'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateCreateOrder, validateOrderId } = require('../src/http/validators/orderValidators');

const limits = { maxItemsPerOrder: 100, maxQtyPerLine: 999 };
const validBody = { userId: 7, items: [{ productId: 1, qty: 2 }] };

const fieldsOf = (error) => error.details.map((detail) => detail.field);

test('accepts a well-formed body and returns typed values', () => {
  const result = validateCreateOrder({ ...validBody, coupon: ' SAVE10 ', email: 'a@b.co' }, limits);
  assert.deepEqual(result, {
    userId: 7,
    items: [{ productId: 1, qty: 2 }],
    couponCode: 'SAVE10',
    email: 'a@b.co',
  });
});

test('rejects a missing items array rather than throwing a TypeError', () => {
  assert.throws(
    () => validateCreateOrder({ userId: 1 }, limits),
    (error) => error.status === 422 && fieldsOf(error).includes('items'),
  );
});

test('rejects an empty cart', () => {
  assert.throws(
    () => validateCreateOrder({ userId: 1, items: [] }, limits),
    (error) => fieldsOf(error).includes('items'),
  );
});

test('rejects a non-numeric productId (the legacy SQL injection vector)', () => {
  assert.throws(
    () => validateCreateOrder({ userId: 1, items: [{ productId: '1 OR 1=1', qty: 1 }] }, limits),
    (error) => fieldsOf(error).includes('items[0].productId'),
  );
});

test('rejects zero, negative and fractional quantities', () => {
  for (const qty of [0, -3, 1.5]) {
    assert.throws(
      () => validateCreateOrder({ userId: 1, items: [{ productId: 1, qty }] }, limits),
      (error) => fieldsOf(error).includes('items[0].qty'),
      `qty ${qty} should be rejected`,
    );
  }
});

test('enforces the per-order item cap', () => {
  const items = Array.from({ length: 101 }, () => ({ productId: 1, qty: 1 }));
  assert.throws(
    () => validateCreateOrder({ userId: 1, items }, limits),
    (error) => fieldsOf(error).includes('items'),
  );
});

test('rejects a malformed email', () => {
  assert.throws(
    () => validateCreateOrder({ ...validBody, email: 'not-an-email' }, limits),
    (error) => fieldsOf(error).includes('email'),
  );
});

test('treats an absent coupon and email as null', () => {
  const result = validateCreateOrder(validBody, limits);
  assert.equal(result.couponCode, null);
  assert.equal(result.email, null);
});

test('reports every problem at once instead of failing on the first', () => {
  try {
    validateCreateOrder({ userId: 'x', items: [{ productId: 0, qty: -1 }] }, limits);
    assert.fail('expected a validation error');
  } catch (error) {
    assert.ok(fieldsOf(error).length >= 3, 'all invalid fields are reported');
  }
});

test('validateOrderId accepts a numeric id and rejects injection attempts', () => {
  assert.equal(validateOrderId('42'), 42);
  assert.throws(() => validateOrderId('1; DROP TABLE orders'), (error) => error.status === 400);
});
