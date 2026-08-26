'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { quoteOrder, discountedUnitPrice } = require('../src/orders/pricing');
const { toMinorUnits, toMajorUnits } = require('../src/money');

const NORMAL_CATEGORY = 1;
const PROMO_CATEGORY = 3;

/**
 * @param {{ id?: number, price: string|number, category?: number }} overrides
 */
function product({ id = 1, price, category = NORMAL_CATEGORY }) {
  return {
    id,
    name: `product-${id}`,
    unitPriceMinor: toMinorUnits(price),
    categoryId: category,
  };
}

/** @param {ReturnType<typeof product>[]} list */
function catalog(list) {
  return new Map(list.map((p) => [p.id, p]));
}

test('ไม่มีส่วนลด ยอดต่ำกว่าเกณฑ์ส่งฟรี → บวกค่าส่ง 60', () => {
  const quote = quoteOrder({
    items: [{ productId: 1, qty: 2 }],
    products: catalog([product({ price: 100 })]),
    coupon: null,
  });

  assert.equal(quote.itemsTotalMinor, 20_000);
  assert.equal(quote.discountMinor, 0);
  assert.equal(quote.shippingMinor, 6_000);
  assert.equal(quote.totalMinor, 26_000);
  assert.equal(toMajorUnits(quote.totalMinor), 260);
});

test('ซื้อเกิน 10 ชิ้น ลดต่อหน่วย 5%', () => {
  const quote = quoteOrder({
    items: [{ productId: 1, qty: 11 }],
    products: catalog([product({ price: 100 })]),
    coupon: null,
  });

  assert.equal(quote.lines[0].unitPriceMinor, 9_500);
  assert.equal(quote.itemsTotalMinor, 104_500);
});

test('ซื้อพอดี 10 ชิ้น ยังไม่ได้ส่วนลด (ขอบเขต > ไม่ใช่ >=)', () => {
  assert.equal(discountedUnitPrice(product({ price: 100 }), 10), 10_000);
  assert.equal(discountedUnitPrice(product({ price: 100 }), 11), 9_500);
});

test('สินค้าหมวดโปรโมชัน ลด 10%', () => {
  const quote = quoteOrder({
    items: [{ productId: 1, qty: 2 }],
    products: catalog([product({ price: 100, category: PROMO_CATEGORY })]),
    coupon: null,
  });

  assert.equal(quote.lines[0].unitPriceMinor, 9_000);
  assert.equal(quote.itemsTotalMinor, 18_000);
});

test('ส่วนลดซื้อเยอะกับหมวดโปรคิดทบกัน = 85.5% ของราคาตั้ง', () => {
  const quote = quoteOrder({
    items: [{ productId: 1, qty: 11 }],
    products: catalog([product({ price: 100, category: PROMO_CATEGORY })]),
    coupon: null,
  });

  assert.equal(quote.lines[0].unitPriceMinor, 8_550);
  assert.equal(quote.totalMinor, 8_550 * 11 + 6_000);
});

test('คูปองแบบเปอร์เซ็นต์หักจากยอดสินค้า', () => {
  const quote = quoteOrder({
    items: [{ productId: 1, qty: 2 }],
    products: catalog([product({ price: 100 })]),
    coupon: { code: 'SAVE10', type: 'percent', value: 10 },
  });

  assert.equal(quote.discountMinor, 2_000);
  assert.equal(quote.totalMinor, 18_000 + 6_000);
});

test('คูปองแบบจำนวนเงินหักตามมูลค่าหน้าคูปอง', () => {
  const quote = quoteOrder({
    items: [{ productId: 1, qty: 2 }],
    products: catalog([product({ price: 100 })]),
    coupon: { code: 'MINUS50', type: 'fixed', value: 50 },
  });

  assert.equal(quote.discountMinor, 5_000);
  assert.equal(quote.totalMinor, 15_000 + 6_000);
});

test('คูปองมูลค่าสูงกว่ายอดสินค้า → ยอดสินค้าเป็น 0 ไม่ติดลบ', () => {
  const quote = quoteOrder({
    items: [{ productId: 1, qty: 2 }],
    products: catalog([product({ price: 100 })]),
    coupon: { code: 'HUGE', type: 'fixed', value: 9_999 },
  });

  assert.equal(quote.discountMinor, 20_000);
  assert.equal(quote.totalMinor, 6_000);
});

test('คูปองเปอร์เซ็นต์เกิน 100 ถูกจำกัดไว้ที่ 100', () => {
  const quote = quoteOrder({
    items: [{ productId: 1, qty: 2 }],
    products: catalog([product({ price: 100 })]),
    coupon: { code: 'BROKEN', type: 'percent', value: 150 },
  });

  assert.equal(quote.discountMinor, 20_000);
  assert.equal(quote.totalMinor, 6_000);
});

test('คูปองค่าติดลบไม่กลายเป็นการบวกเงินเพิ่ม', () => {
  const quote = quoteOrder({
    items: [{ productId: 1, qty: 2 }],
    products: catalog([product({ price: 100 })]),
    coupon: { code: 'NEGATIVE', type: 'fixed', value: -500 },
  });

  assert.equal(quote.discountMinor, 0);
  assert.equal(quote.totalMinor, 26_000);
});

test('ยอดเท่าเกณฑ์ส่งฟรีพอดียังต้องจ่ายค่าส่ง แต่เกินไป 1 สตางค์ได้ส่งฟรี', () => {
  const atThreshold = quoteOrder({
    items: [{ productId: 1, qty: 1 }],
    products: catalog([product({ price: 1_500 })]),
    coupon: null,
  });
  assert.equal(atThreshold.shippingMinor, 6_000);
  assert.equal(atThreshold.totalMinor, 156_000);

  const aboveThreshold = quoteOrder({
    items: [{ productId: 1, qty: 1 }],
    products: catalog([product({ price: '1500.01' })]),
    coupon: null,
  });
  assert.equal(aboveThreshold.shippingMinor, 0);
  assert.equal(aboveThreshold.totalMinor, 150_001);
});

test('คูปองที่ดึงยอดต่ำกว่าเกณฑ์ทำให้กลับมาเสียค่าส่ง (คิดค่าส่งจากยอดหลังหักคูปอง)', () => {
  const quote = quoteOrder({
    items: [{ productId: 1, qty: 1 }],
    products: catalog([product({ price: 1_600 })]),
    coupon: { code: 'MINUS100', type: 'fixed', value: 100 },
  });

  assert.equal(quote.shippingMinor, 6_000);
  assert.equal(quote.totalMinor, 156_000);
});

test('ราคาที่มีเศษสตางค์ไม่สะสมความคลาดเคลื่อนแบบ float', () => {
  const quote = quoteOrder({
    items: [{ productId: 1, qty: 11 }],
    products: catalog([product({ price: '33.33' })]),
    coupon: null,
  });

  assert.equal(quote.lines[0].unitPriceMinor, 3_166);
  assert.equal(quote.itemsTotalMinor, 34_826);
  assert.equal(toMajorUnits(quote.totalMinor), 408.26);
});

test('หลายบรรทัดรวมกันถูกต้อง และสินค้าเดียวกันสองบรรทัดคิดแยกกัน', () => {
  const quote = quoteOrder({
    items: [
      { productId: 1, qty: 2 },
      { productId: 2, qty: 11 },
      { productId: 1, qty: 1 },
    ],
    products: catalog([
      product({ id: 1, price: 100 }),
      product({ id: 2, price: 50, category: PROMO_CATEGORY }),
    ]),
    coupon: null,
  });

  assert.equal(quote.lines.length, 3);
  assert.equal(quote.lines[1].unitPriceMinor, 4_275);
  assert.equal(quote.itemsTotalMinor, 20_000 + 47_025 + 10_000);
});

test('เรียกโดยไม่มีสินค้าครบใน catalog ถือเป็นบั๊กของผู้เรียก ไม่ใช่คิดราคาเป็น 0', () => {
  assert.throws(
    () =>
      quoteOrder({
        items: [{ productId: 99, qty: 1 }],
        products: catalog([product({ price: 100 })]),
        coupon: null,
      }),
    /product 99/,
  );
});

test('toMinorUnits ปฏิเสธค่าที่ไม่ใช่ตัวเลข', () => {
  assert.equal(toMinorUnits('19.99'), 1_999);
  assert.throws(() => toMinorUnits(null), TypeError);
  assert.throws(() => toMinorUnits('abc'), TypeError);
});
