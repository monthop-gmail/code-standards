'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createOrderService } = require('../src/orders/order.service');
const { ValidationError, NotFoundError } = require('../src/errors');

/**
 * fake pool ที่นับ commit/rollback/release เพื่อพิสูจน์ว่า transaction ถูกปิดจริงทุกเส้นทาง
 */
function createFakePool() {
  const calls = { begin: 0, commit: 0, rollback: 0, release: 0 };
  const connection = {
    async beginTransaction() { calls.begin += 1; },
    async commit() { calls.commit += 1; },
    async rollback() { calls.rollback += 1; },
    release() { calls.release += 1; },
  };
  return { pool: { async getConnection() { return connection; } }, calls };
}

function createFakeLogger() {
  const entries = { info: [], error: [] };
  return {
    logger: {
      info: (event, meta) => entries.info.push({ event, meta }),
      error: (event, meta) => entries.error.push({ event, meta }),
    },
    entries,
  };
}

/**
 * @param {object} [overrides]
 */
function createFakeRepository(overrides = {}) {
  const seen = { insertedOrder: null, insertedLines: null };
  const repository = {
    async findProductsByIds() {
      return [{ id: 1, name: 'Widget', price: '100.00', category: 1 }];
    },
    async findCouponByCode() {
      return null;
    },
    async findUserEmail() {
      return 'customer@example.com';
    },
    async insertOrder(_conn, order) {
      seen.insertedOrder = order;
      return 4242;
    },
    async insertOrderItems(_conn, orderId, lines) {
      seen.insertedLines = { orderId, lines };
    },
    async findOrderForUser() {
      return null;
    },
    async findOrderItems() {
      return [];
    },
    ...overrides,
  };
  return { repository, seen };
}

function buildService(overrides = {}) {
  const { pool, calls } = createFakePool();
  const { logger, entries } = createFakeLogger();
  const { repository, seen } = createFakeRepository(overrides.repository);
  const mailCalls = [];
  const mailer = overrides.mailer ?? {
    async sendOrderConfirmation(input) { mailCalls.push(input); },
  };
  const service = createOrderService({ pool, repository, mailer, logger });
  return { service, calls, entries, seen, mailCalls };
}

const oneItem = { items: [{ productId: 1, qty: 1 }], couponCode: null };

test('happy path: บันทึกใน transaction แล้วคืนยอดที่คิดจากราคาใน DB', async () => {
  const { service, calls, seen } = buildService();

  const result = await service.createOrder(77, oneItem);

  assert.equal(result.orderId, 4242);
  assert.equal(result.totalMinor, 16_000);
  assert.equal(result.total, 160);
  assert.deepEqual(seen.insertedOrder, { userId: 77, totalMinor: 16_000 });
  assert.equal(seen.insertedLines.orderId, 4242);
  assert.equal(seen.insertedLines.lines.length, 1);
  assert.deepEqual(calls, { begin: 1, commit: 1, rollback: 0, release: 1 });
});

test('อีเมลยืนยันส่งไปที่อยู่ของเจ้าของบัญชี ไม่ใช่ที่อยู่ที่ผู้เรียกส่งมา', async () => {
  const { service, mailCalls } = buildService();

  await service.createOrder(77, oneItem);

  assert.deepEqual(mailCalls, [{ to: 'customer@example.com', orderId: 4242 }]);
});

test('สินค้าที่ไม่มีอยู่จริง: ตอบ ValidationError และไม่แตะ DB ฝั่งเขียน', async () => {
  const { service, seen, calls } = buildService({
    repository: { async findProductsByIds() { return []; } },
  });

  await assert.rejects(
    () => service.createOrder(77, { items: [{ productId: 9, qty: 1 }], couponCode: null }),
    (error) => error instanceof ValidationError && error.details.missingProductIds.includes(9)
  );
  assert.equal(seen.insertedOrder, null);
  assert.equal(calls.begin, 0);
});

test('คูปองไม่มีอยู่จริง: ตอบ error ชัดเจน แทนที่จะเงียบ ๆ ไม่ลดราคาแบบเดิม', async () => {
  const { service } = buildService();

  await assert.rejects(
    () => service.createOrder(77, { items: [{ productId: 1, qty: 1 }], couponCode: 'NOPE' }),
    ValidationError
  );
});

test('คูปองที่มีอยู่จริงถูกนำมาคิด', async () => {
  const { service } = buildService({
    repository: {
      async findCouponByCode() { return { code: 'SAVE10', type: 'percent', value: '10' }; },
    },
  });

  const result = await service.createOrder(77, { items: [{ productId: 1, qty: 1 }], couponCode: 'SAVE10' });

  assert.equal(result.couponDiscountMinor, 1_000);
  assert.equal(result.totalMinor, 15_000);
});

test('insert order_items พัง: rollback และคืน connection ก่อนโยน error ต่อ', async () => {
  const { service, calls } = buildService({
    repository: {
      async insertOrderItems() { throw new Error('deadlock found when trying to get lock'); },
    },
  });

  await assert.rejects(() => service.createOrder(77, oneItem), /deadlock/);
  assert.deepEqual(calls, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('ส่งอีเมลไม่สำเร็จไม่ทำให้ order ที่ commit แล้วล้ม แต่ต้องมี log พร้อม orderId', async () => {
  const { service, entries } = buildService({
    mailer: { async sendOrderConfirmation() { throw new Error('mail gateway timeout'); } },
  });

  const result = await service.createOrder(77, oneItem);

  assert.equal(result.orderId, 4242);
  const failure = entries.error.find((entry) => entry.event === 'order.confirmation.failed');
  assert.ok(failure, 'ต้องมี log บอกว่าอีเมลส่งไม่ออก');
  assert.equal(failure.meta.orderId, 4242);
});

test('บัญชีที่ไม่มีอีเมลไม่ทำให้ order ล้ม แต่ถูก log ไว้', async () => {
  const { service, entries, mailCalls } = buildService({
    repository: { async findUserEmail() { return null; } },
  });

  await service.createOrder(77, oneItem);

  assert.equal(mailCalls.length, 0);
  assert.ok(entries.error.some((entry) => entry.event === 'order.confirmation.skipped_no_email'));
});

test('log ของ order ที่สร้างสำเร็จไม่มี PII ของลูกค้า', async () => {
  const { service, entries } = buildService();

  await service.createOrder(77, oneItem);

  const created = entries.info.find((entry) => entry.event === 'order.created');
  assert.deepEqual(Object.keys(created.meta).sort(), ['lineCount', 'orderId', 'totalMinor', 'userId']);
});

test('ดู order ของคนอื่นได้ 404 ไม่ใช่ 403 — ไม่ยืนยันว่า id นั้นมีอยู่', async () => {
  const { service } = buildService();

  await assert.rejects(
    () => service.getOrder(1, 77),
    (error) => error instanceof NotFoundError && error.status === 404 && error.code === 'ORDER_NOT_FOUND'
  );
});

test('ดู order ของตัวเองได้ข้อมูลพร้อมชื่อสินค้าจาก JOIN เดียว', async () => {
  let itemQueryCount = 0;
  const { service } = buildService({
    repository: {
      async findOrderForUser() {
        return { id: 5, user_id: 77, total: '160.00', status: 'new', created_at: new Date('2026-01-01T00:00:00Z') };
      },
      async findOrderItems() {
        itemQueryCount += 1;
        return [
          { product_id: 1, name: 'Widget', unit_price: '100.00', qty: 1 },
          { product_id: 2, name: null, unit_price: '30.00', qty: 2 },
        ];
      },
    },
  });

  const order = await service.getOrder(5, 77);

  assert.equal(itemQueryCount, 1);
  assert.equal(order.orderId, 5);
  assert.equal(order.total, 160);
  assert.deepEqual(order.items[0], { productId: 1, name: 'Widget', qty: 1, unitPrice: 100 });
  assert.equal(order.items[1].name, null, 'สินค้าที่ถูกลบไปแล้วต้องไม่ทำให้ endpoint พัง');
});
