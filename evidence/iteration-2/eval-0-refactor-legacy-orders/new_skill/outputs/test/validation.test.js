'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCreateOrderInput, parseIdParam } = require('../src/orders/validation');
const { AppError } = require('../src/errors');

/** @param {unknown} body */
function expectRejected(body) {
  try {
    parseCreateOrderInput(body);
  } catch (error) {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(error.status, 400);
    return error;
  }
  assert.fail('expected parseCreateOrderInput to reject');
}

test('payload ที่ถูกต้องถูกแปลงเป็น input ที่ typed แล้ว', () => {
  const input = parseCreateOrderInput({
    items: [{ productId: 7, qty: 2 }],
    coupon: '  SAVE10 ',
    email: ' buyer@example.com ',
  });

  assert.deepEqual(input, {
    items: [{ productId: 7, qty: 2 }],
    couponCode: 'SAVE10',
    email: 'buyer@example.com',
  });
});

test('userId ที่ client ส่งมาถูกทิ้ง ไม่หลุดเข้าไปในระบบ', () => {
  const input = parseCreateOrderInput({ items: [{ productId: 1, qty: 1 }], userId: 999 });
  assert.equal('userId' in input, false);
});

test('coupon และ email เป็นค่าเลือกใส่ ไม่ใส่ได้ค่า null', () => {
  const input = parseCreateOrderInput({ items: [{ productId: 1, qty: 1 }] });
  assert.equal(input.couponCode, null);
  assert.equal(input.email, null);

  const emptyStrings = parseCreateOrderInput({
    items: [{ productId: 1, qty: 1 }],
    coupon: '',
    email: '',
  });
  assert.equal(emptyStrings.couponCode, null);
  assert.equal(emptyStrings.email, null);
});

test('body ที่ไม่ใช่ object ถูกปฏิเสธ', () => {
  expectRejected(null);
  expectRejected('items=1');
  expectRejected([{ productId: 1, qty: 1 }]);
});

test('items ต้องเป็น array ที่ไม่ว่าง', () => {
  expectRejected({});
  expectRejected({ items: [] });
  expectRejected({ items: 'nope' });
});

test('items ยาวเกินเพดานถูกปฏิเสธก่อนไปถึง DB', () => {
  const tooMany = Array.from({ length: 101 }, () => ({ productId: 1, qty: 1 }));
  const error = expectRejected({ items: tooMany });
  assert.match(error.details.fields[0], /at most 100/);
});

test('qty และ productId ต้องเป็นจำนวนเต็มบวก', () => {
  for (const qty of [0, -1, 1.5, '2.5', null, undefined, NaN, 1e21]) {
    expectRejected({ items: [{ productId: 1, qty }] });
  }
  for (const productId of [0, -3, 2.5, '', {}, null]) {
    expectRejected({ items: [{ productId, qty: 1 }] });
  }
});

test('qty เกินเพดานต่อรายการถูกปฏิเสธ', () => {
  expectRejected({ items: [{ productId: 1, qty: 1_001 }] });
  assert.equal(parseCreateOrderInput({ items: [{ productId: 1, qty: 1_000 }] }).items[0].qty, 1_000);
});

test('ตัวเลขที่ส่งมาเป็น string ใช้ได้ (form ส่งมาเป็น string เสมอ)', () => {
  const input = parseCreateOrderInput({ items: [{ productId: '7', qty: '2' }] });
  assert.deepEqual(input.items, [{ productId: 7, qty: 2 }]);
});

test('รายงาน field ที่ผิดครบทุกอันในครั้งเดียว', () => {
  const error = expectRejected({
    items: [{ productId: 0, qty: 0 }],
    coupon: 123,
    email: 'not-an-email',
  });
  assert.equal(error.details.fields.length, 4);
});

test('coupon ที่ยาวเกินหรือไม่ใช่ string ถูกปฏิเสธ', () => {
  expectRejected({ items: [{ productId: 1, qty: 1 }], coupon: 'x'.repeat(65) });
  expectRejected({ items: [{ productId: 1, qty: 1 }], coupon: '   ' });
  expectRejected({ items: [{ productId: 1, qty: 1 }], coupon: { code: 'X' } });
});

test('อีเมลที่มีอักขระไม่ใช่ ASCII ในชื่อผู้ใช้ยังผ่าน', () => {
  const input = parseCreateOrderInput({
    items: [{ productId: 1, qty: 1 }],
    email: 'ลูกค้า@example.com',
  });
  assert.equal(input.email, 'ลูกค้า@example.com');
});

test('parseIdParam รับเฉพาะจำนวนเต็มบวก', () => {
  assert.equal(parseIdParam('12', 'order id'), 12);
  for (const raw of ['0', '-1', 'abc', '1 OR 1=1', '', undefined, '1.5']) {
    assert.throws(() => parseIdParam(raw, 'order id'), (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 400);
      return true;
    });
  }
});
