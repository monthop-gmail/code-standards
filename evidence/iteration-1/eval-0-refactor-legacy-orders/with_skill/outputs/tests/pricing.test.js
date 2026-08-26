'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  priceOrder,
  toMajorUnits,
  SHIPPING_FEE_MINOR,
  FREE_SHIPPING_THRESHOLD_MINOR,
} = require('../src/orders/pricing');
const { ValidationError, DataIntegrityError } = require('../src/errors');

/**
 * @param {Partial<import('../src/orders/pricing').ProductRow>} [overrides]
 */
function product(overrides = {}) {
  // price เป็น string เหมือนที่ mysql2 ส่ง DECIMAL กลับมาจริง ๆ
  return { id: 1, name: 'Widget', price: '100.00', category: 1, ...overrides };
}

/**
 * @param {import('../src/orders/pricing').ProductRow[]} products
 */
function catalog(products) {
  return new Map(products.map((p) => [p.id, p]));
}

test('ราคาปกติ: ไม่มีส่วนลด บวกค่าส่งเมื่อยอดไม่ถึงเกณฑ์', () => {
  const result = priceOrder({
    items: [{ productId: 1, qty: 10 }],
    productsById: catalog([product()]),
    coupon: null,
  });

  assert.equal(result.subtotalMinor, 100_000);
  assert.equal(result.couponDiscountMinor, 0);
  assert.equal(result.shippingMinor, SHIPPING_FEE_MINOR);
  assert.equal(result.totalMinor, 106_000);
});

test('ส่วนลดจำนวนมากเริ่มที่ qty 11 ไม่ใช่ 10 (ขอบของเงื่อนไข qty > 10 เดิม)', () => {
  const at10 = priceOrder({ items: [{ productId: 1, qty: 10 }], productsById: catalog([product()]), coupon: null });
  const at11 = priceOrder({ items: [{ productId: 1, qty: 11 }], productsById: catalog([product()]), coupon: null });

  assert.equal(at10.lines[0].unitPriceMinor, 10_000);
  assert.equal(at11.lines[0].unitPriceMinor, 9_500);
});

test('สินค้าหมวดโปรโมชันลด 10%', () => {
  const result = priceOrder({
    items: [{ productId: 1, qty: 1 }],
    productsById: catalog([product({ category: 3 })]),
    coupon: null,
  });

  assert.equal(result.lines[0].unitPriceMinor, 9_000);
});

test('ส่วนลดจำนวนมาก + หมวดโปรโมชัน ทบกันแบบคูณ ตามพฤติกรรมเดิม', () => {
  const result = priceOrder({
    items: [{ productId: 1, qty: 11 }],
    productsById: catalog([product({ category: 3 })]),
    coupon: null,
  });

  assert.equal(result.lines[0].unitPriceMinor, 8_550);
  assert.equal(result.subtotalMinor, 94_050);
  assert.equal(result.totalMinor, 100_050);
});

test('คูปองแบบเปอร์เซ็นต์หักจากยอดรวมหลังส่วนลดรายการ', () => {
  const result = priceOrder({
    items: [{ productId: 1, qty: 10 }],
    productsById: catalog([product()]),
    coupon: { code: 'SAVE10', type: 'percent', value: '10' },
  });

  assert.equal(result.couponDiscountMinor, 10_000);
  assert.equal(result.totalMinor, 96_000);
});

test('คูปองแบบจำนวนเงินหักตรง ๆ', () => {
  const result = priceOrder({
    items: [{ productId: 1, qty: 10 }],
    productsById: catalog([product()]),
    coupon: { code: 'MINUS50', type: 'fixed', value: '50.00' },
  });

  assert.equal(result.couponDiscountMinor, 5_000);
  assert.equal(result.totalMinor, 101_000);
});

test('คูปองที่ใหญ่กว่ายอดสั่งซื้อไม่ทำให้ยอดติดลบ', () => {
  const result = priceOrder({
    items: [{ productId: 1, qty: 1 }],
    productsById: catalog([product()]),
    coupon: { code: 'HUGE', type: 'fixed', value: '9999.00' },
  });

  assert.equal(result.couponDiscountMinor, 10_000);
  assert.equal(result.totalMinor, SHIPPING_FEE_MINOR);
});

test('ค่าส่งฟรีเมื่อยอด "เกิน" เกณฑ์ ไม่ใช่ "เท่ากับ" เกณฑ์', () => {
  const exactly = priceOrder({
    items: [{ productId: 1, qty: 1 }],
    productsById: catalog([product({ price: '1500.00' })]),
    coupon: null,
  });
  const justOver = priceOrder({
    items: [{ productId: 1, qty: 1 }],
    productsById: catalog([product({ price: '1500.01' })]),
    coupon: null,
  });

  assert.equal(exactly.subtotalMinor, FREE_SHIPPING_THRESHOLD_MINOR);
  assert.equal(exactly.shippingMinor, SHIPPING_FEE_MINOR);
  assert.equal(justOver.shippingMinor, 0);
});

test('คูปองที่ดันยอดต่ำกว่าเกณฑ์ ทำให้กลับมาเสียค่าส่ง', () => {
  const result = priceOrder({
    items: [{ productId: 1, qty: 1 }],
    productsById: catalog([product({ price: '1600.00' })]),
    coupon: { code: 'SAVE20', type: 'percent', value: '20' },
  });

  assert.equal(result.shippingMinor, SHIPPING_FEE_MINOR);
  assert.equal(result.totalMinor, 134_000);
});

test('คิดเงินบนจำนวนเต็มสตางค์ ไม่มีเศษ float หลุด', () => {
  const result = priceOrder({
    items: [{ productId: 1, qty: 3 }],
    productsById: catalog([product({ price: '0.10' })]),
    coupon: null,
  });

  assert.equal(result.subtotalMinor, 30);
  assert.equal(toMajorUnits(result.subtotalMinor), 0.3);
});

test('หลายรายการรวมกันถูกต้อง', () => {
  const result = priceOrder({
    items: [
      { productId: 1, qty: 2 },
      { productId: 2, qty: 1 },
    ],
    productsById: catalog([product(), product({ id: 2, name: 'Gadget', price: '25.50' })]),
    coupon: null,
  });

  assert.equal(result.lines.length, 2);
  assert.equal(result.subtotalMinor, 20_000 + 2_550);
});

test('ตะกร้าว่างถูกปฏิเสธ', () => {
  assert.throws(
    () => priceOrder({ items: [], productsById: new Map(), coupon: null }),
    ValidationError
  );
});

test('จำนวนสินค้าเป็นศูนย์หรือติดลบถูกปฏิเสธ', () => {
  for (const qty of [0, -5, 1.5]) {
    assert.throws(
      () => priceOrder({ items: [{ productId: 1, qty }], productsById: catalog([product()]), coupon: null }),
      ValidationError,
      `qty ${qty} ต้องถูกปฏิเสธ`
    );
  }
});

test('สินค้าที่ไม่มีในแคตตาล็อกถูกปฏิเสธ แทนที่จะพังเป็น TypeError แบบเดิม', () => {
  assert.throws(
    () => priceOrder({ items: [{ productId: 99, qty: 1 }], productsById: catalog([product()]), coupon: null }),
    ValidationError
  );
});

test('คูปองที่ type ไม่รู้จักต้องดัง ไม่ใช่เงียบ ๆ ลดเป็นจำนวนเงิน', () => {
  assert.throws(
    () =>
      priceOrder({
        items: [{ productId: 1, qty: 1 }],
        productsById: catalog([product()]),
        coupon: { code: 'WEIRD', type: 'percnt', value: '10' },
      }),
    DataIntegrityError
  );
});

test('คูปองเปอร์เซ็นต์เกิน 100 ถูกปฏิเสธ ไม่ปล่อยให้ยอดพลิก', () => {
  assert.throws(
    () =>
      priceOrder({
        items: [{ productId: 1, qty: 1 }],
        productsById: catalog([product()]),
        coupon: { code: 'BROKEN', type: 'percent', value: '150' },
      }),
    DataIntegrityError
  );
});

test('ราคาสินค้าที่อ่านไม่ได้ต้องดังทันที ไม่กลายเป็น NaN ลง DB', () => {
  assert.throws(
    () =>
      priceOrder({
        items: [{ productId: 1, qty: 1 }],
        productsById: catalog([product({ price: null })]),
        coupon: null,
      }),
    DataIntegrityError
  );
});
