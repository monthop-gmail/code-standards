'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateCreateOrderPayload,
  validateOrderId,
  MAX_ITEMS_PER_ORDER,
  MAX_QTY_PER_ITEM,
} = require('../src/orders/order.validation');
const { ValidationError } = require('../src/errors');

test('payload ที่ถูกต้องถูกแปลงเป็น type ที่แน่นอน', () => {
  const input = validateCreateOrderPayload({
    items: [{ productId: '7', qty: '2' }],
    coupon: '  SAVE10  ',
    userId: 999,
  });

  assert.deepEqual(input, { items: [{ productId: 7, qty: 2 }], couponCode: 'SAVE10' });
});

test('userId จาก body ถูกทิ้ง — สิทธิ์ต้องมาจาก session เท่านั้น', () => {
  const input = validateCreateOrderPayload({ items: [{ productId: 1, qty: 1 }], userId: 42 });
  assert.equal('userId' in input, false);
});

test('body ที่ไม่ใช่ object ถูกปฏิเสธ', () => {
  for (const body of [null, undefined, 'x', 42, []]) {
    assert.throws(() => validateCreateOrderPayload(body), ValidationError);
  }
});

test('items ว่างหรือไม่ใช่ array ถูกปฏิเสธ', () => {
  assert.throws(() => validateCreateOrderPayload({ items: [] }), ValidationError);
  assert.throws(() => validateCreateOrderPayload({ items: 'all' }), ValidationError);
  assert.throws(() => validateCreateOrderPayload({}), ValidationError);
});

test('จำนวนรายการเกินเพดานถูกปฏิเสธ — กัน payload ใหญ่ลาก DB', () => {
  const items = Array.from({ length: MAX_ITEMS_PER_ORDER + 1 }, (_, i) => ({ productId: i + 1, qty: 1 }));
  assert.throws(() => validateCreateOrderPayload({ items }), ValidationError);
});

test('qty ที่เป็นศูนย์ ติดลบ ทศนิยม หรือเกินเพดาน ถูกปฏิเสธ', () => {
  for (const qty of [0, -1, 1.5, MAX_QTY_PER_ITEM + 1, '', null, NaN, Infinity]) {
    assert.throws(
      () => validateCreateOrderPayload({ items: [{ productId: 1, qty }] }),
      ValidationError,
      `qty ${String(qty)} ต้องถูกปฏิเสธ`
    );
  }
});

test('productId ที่ไม่ใช่จำนวนเต็มบวกถูกปฏิเสธ', () => {
  for (const productId of [0, -3, 'abc', '1; DROP TABLE products', null, {}]) {
    assert.throws(
      () => validateCreateOrderPayload({ items: [{ productId, qty: 1 }] }),
      ValidationError,
      `productId ${String(productId)} ต้องถูกปฏิเสธ`
    );
  }
});

test('สินค้าซ้ำในตะกร้าถูกปฏิเสธ แทนที่จะได้สองบรรทัดที่คิดเงินคนละแบบ', () => {
  assert.throws(
    () =>
      validateCreateOrderPayload({
        items: [
          { productId: 1, qty: 6 },
          { productId: 1, qty: 6 },
        ],
      }),
    ValidationError
  );
});

test('รหัสคูปองที่มีอักขระแปลกถูกปฏิเสธ (defense-in-depth ทั้งที่ query ผูกพารามิเตอร์แล้ว)', () => {
  for (const coupon of ["' OR 1=1 --", 'A'.repeat(65), 'SAVE 10', 'ลด10%', 123]) {
    assert.throws(
      () => validateCreateOrderPayload({ items: [{ productId: 1, qty: 1 }], coupon }),
      ValidationError,
      `coupon ${String(coupon)} ต้องถูกปฏิเสธ`
    );
  }
});

test('ไม่ใส่คูปอง หรือใส่ค่าว่าง ถือว่าไม่มีคูปอง', () => {
  for (const coupon of [undefined, null, '', '   ']) {
    assert.equal(validateCreateOrderPayload({ items: [{ productId: 1, qty: 1 }], coupon }).couponCode, null);
  }
});

test('orderId จาก path param ถูกแปลงและตรวจ', () => {
  assert.equal(validateOrderId('12'), 12);
  for (const raw of ['abc', '0', '-1', '1 OR 1=1', '1.5', '']) {
    assert.throws(() => validateOrderId(raw), ValidationError, `orderId ${raw} ต้องถูกปฏิเสธ`);
  }
});
