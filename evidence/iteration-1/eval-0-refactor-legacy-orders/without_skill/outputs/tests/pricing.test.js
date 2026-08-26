'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRICING_RULES,
  discountedUnitPrice,
  priceLines,
  applyCoupon,
  shippingFeeFor,
  quoteOrder,
} = require('../src/domain/pricing');
const { toMinorUnits, toMajorUnits } = require('../src/domain/money');

const productMap = (products) => new Map(products.map((p) => [p.id, p]));

test('discountedUnitPrice: no discount for a small quantity in a normal category', () => {
  assert.equal(discountedUnitPrice(10000, { qty: 1, categoryId: 1 }), 10000);
});

test('discountedUnitPrice: bulk discount applies strictly above the threshold', () => {
  const atThreshold = discountedUnitPrice(10000, { qty: PRICING_RULES.bulkQuantityThreshold, categoryId: 1 });
  const aboveThreshold = discountedUnitPrice(10000, { qty: PRICING_RULES.bulkQuantityThreshold + 1, categoryId: 1 });

  assert.equal(atThreshold, 10000, 'qty == 10 is not bulk');
  assert.equal(aboveThreshold, 9500, 'qty == 11 gets 5% off');
});

test('discountedUnitPrice: category discount applies to promoted categories only', () => {
  assert.equal(discountedUnitPrice(10000, { qty: 1, categoryId: 3 }), 9000);
  assert.equal(discountedUnitPrice(10000, { qty: 1, categoryId: 4 }), 10000);
});

test('discountedUnitPrice: bulk and category discounts stack multiplicatively', () => {
  // 10000 -> 9500 (5% bulk) -> 8550 (10% category)
  assert.equal(discountedUnitPrice(10000, { qty: 11, categoryId: 3 }), 8550);
});

test('discountedUnitPrice: rounds to whole minor units rather than drifting on floats', () => {
  // 3333 * 0.95 = 3166.35 -> discount rounds to 158, leaving 3175
  const price = discountedUnitPrice(3333, { qty: 11, categoryId: 1 });
  assert.ok(Number.isInteger(price), 'price must stay an integer');
  assert.equal(price, 3333 - Math.round(3333 * 0.05));
});

test('priceLines: computes line totals and the subtotal', () => {
  const products = productMap([
    { id: 1, name: 'Widget', price: 100, category: 1 },
    { id: 2, name: 'Gizmo', price: 50, category: 3 },
  ]);
  const { lines, subtotal } = priceLines(
    [
      { productId: 1, qty: 2 },
      { productId: 2, qty: 1 },
    ],
    products,
  );

  assert.equal(lines[0].lineTotal, 20000);
  assert.equal(lines[1].unitPrice, 4500, '10% category discount on 50.00');
  assert.equal(subtotal, 24500);
});

test('priceLines: rejects an unknown product instead of crashing on undefined', () => {
  assert.throws(
    () => priceLines([{ productId: 99, qty: 1 }], productMap([])),
    (error) => error.status === 400 && /does not exist/.test(error.message),
  );
});

test('priceLines: handles DECIMAL prices returned as strings by mysql2', () => {
  const products = productMap([{ id: 1, name: 'Widget', price: '19.99', category: 1 }]);
  const { subtotal } = priceLines([{ productId: 1, qty: 3 }], products);
  assert.equal(subtotal, 5997);
});

test('applyCoupon: percent coupon', () => {
  assert.deepEqual(applyCoupon(20000, { type: 'percent', value: 10 }), { total: 18000, discount: 2000 });
});

test('applyCoupon: fixed coupon', () => {
  assert.deepEqual(applyCoupon(20000, { type: 'fixed', value: 50 }), { total: 15000, discount: 5000 });
});

test('applyCoupon: a fixed coupon larger than the cart can never go negative', () => {
  const result = applyCoupon(1000, { type: 'fixed', value: 500 });
  assert.equal(result.total, 0);
  assert.equal(result.discount, 1000, 'discount is capped at the subtotal');
});

test('applyCoupon: a null coupon is a no-op', () => {
  assert.deepEqual(applyCoupon(12345, null), { total: 12345, discount: 0 });
});

test('shippingFeeFor: free at or above the threshold, flat fee below it', () => {
  assert.equal(shippingFeeFor(PRICING_RULES.freeShippingThreshold), 0);
  assert.equal(shippingFeeFor(PRICING_RULES.freeShippingThreshold - 1), PRICING_RULES.shippingFee);
});

test('quoteOrder: end-to-end quote with coupon and shipping', () => {
  const products = productMap([{ id: 1, name: 'Widget', price: 100, category: 1 }]);
  const quote = quoteOrder({
    items: [{ productId: 1, qty: 2 }],
    productsById: products,
    coupon: { type: 'percent', value: 10 },
  });

  assert.equal(quote.subtotal, 20000);
  assert.equal(quote.discount, 2000);
  assert.equal(quote.shipping, 6000, 'below the free-shipping threshold');
  assert.equal(quote.total, 24000);
});

test('quoteOrder: a large order ships free', () => {
  const products = productMap([{ id: 1, name: 'Widget', price: 1000, category: 1 }]);
  const quote = quoteOrder({ items: [{ productId: 1, qty: 2 }], productsById: products });

  assert.equal(quote.shipping, 0);
  assert.equal(quote.total, 200000);
});

test('money: minor/major unit round-trip is exact for classic float traps', () => {
  assert.equal(toMinorUnits(0.1) + toMinorUnits(0.2), toMinorUnits(0.3));
  assert.equal(toMajorUnits(toMinorUnits(19.99)), 19.99);
});
