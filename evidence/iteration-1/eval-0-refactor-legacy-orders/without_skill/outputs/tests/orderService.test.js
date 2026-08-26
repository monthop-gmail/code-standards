'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { OrderService } = require('../src/services/orderService');

/**
 * In-memory fakes. The service takes its collaborators as constructor
 * arguments, so the whole create-order workflow is testable without a
 * database or a mail server.
 */
function buildService({ products = [], coupon = null, failOnItems = false } = {}) {
  const state = { orders: [], items: [], notifications: [], committed: null, rolledBack: false };

  const connection = {
    beginTransaction: async () => {},
    commit: async () => { state.committed = true; },
    rollback: async () => { state.rolledBack = true; },
    release: () => {},
    query: async () => [{ insertId: 1 }],
  };
  const pool = { getConnection: async () => connection };

  const productRepository = {
    findByIds: async (ids) =>
      new Map(products.filter((p) => ids.includes(p.id)).map((p) => [p.id, p])),
    findNamesByIds: async (ids) =>
      new Map(products.filter((p) => ids.includes(p.id)).map((p) => [p.id, p.name])),
  };
  const couponRepository = { findRedeemableByCode: async () => coupon };

  const orderRepository = {
    withConnection: () => ({
      createOrder: async (order) => {
        state.orders.push(order);
        return 1001;
      },
      createOrderItems: async (orderId, lines) => {
        if (failOnItems) throw new Error('items insert exploded');
        state.items.push({ orderId, lines });
      },
    }),
    findById: async () => state.orders[0] ?? null,
    findItemsByOrderId: async () => [],
  };

  const notificationService = {
    sendOrderConfirmation: async (payload) => {
      state.notifications.push(payload);
      return true;
    },
  };

  const service = new OrderService({
    pool,
    productRepository,
    couponRepository,
    orderRepository,
    notificationService,
  });

  return { service, state };
}

const CATALOG = [
  { id: 1, name: 'Widget', price: 100, category: 1 },
  { id: 2, name: 'Gizmo', price: 50, category: 3 },
];

test('createOrder returns a priced order and persists it', async () => {
  const { service, state } = buildService({ products: CATALOG });

  const result = await service.createOrder({
    userId: 7,
    items: [{ productId: 1, qty: 2 }],
    couponCode: null,
    email: 'buyer@example.com',
  });

  assert.equal(result.orderId, 1001);
  assert.equal(result.subtotal, 200);
  assert.equal(result.shipping, 60);
  assert.equal(result.total, 260);
  assert.equal(state.orders.length, 1);
  assert.equal(state.items[0].lines.length, 1);
});

test('createOrder sends a confirmation with the order id only', async () => {
  const { service, state } = buildService({ products: CATALOG });
  await service.createOrder({
    userId: 7,
    items: [{ productId: 1, qty: 1 }],
    couponCode: null,
    email: 'buyer@example.com',
  });

  assert.deepEqual(state.notifications[0], { to: 'buyer@example.com', orderId: 1001 });
});

test('createOrder commits the transaction on success', async () => {
  const { service, state } = buildService({ products: CATALOG });
  await service.createOrder({ userId: 1, items: [{ productId: 1, qty: 1 }], couponCode: null, email: null });

  assert.equal(state.committed, true);
  assert.equal(state.rolledBack, false);
});

test('createOrder rolls back if inserting the line items fails', async () => {
  const { service, state } = buildService({ products: CATALOG, failOnItems: true });

  await assert.rejects(
    service.createOrder({ userId: 1, items: [{ productId: 1, qty: 1 }], couponCode: null, email: null }),
    /items insert exploded/,
  );
  assert.equal(state.rolledBack, true, 'no half-written order is left behind');
  assert.equal(state.committed, null);
});

test('createOrder applies a valid coupon', async () => {
  const { service } = buildService({
    products: CATALOG,
    coupon: { id: 5, code: 'SAVE10', type: 'percent', value: 10 },
  });

  const result = await service.createOrder({
    userId: 1,
    items: [{ productId: 1, qty: 2 }],
    couponCode: 'SAVE10',
    email: null,
  });

  assert.equal(result.discount, 20);
  assert.equal(result.total, 240);
});

test('createOrder rejects an unknown or expired coupon instead of silently ignoring it', async () => {
  const { service } = buildService({ products: CATALOG, coupon: null });

  await assert.rejects(
    service.createOrder({ userId: 1, items: [{ productId: 1, qty: 1 }], couponCode: 'EXPIRED', email: null }),
    (error) => error.status === 400 && /not valid or has expired/.test(error.message),
  );
});

test('createOrder rejects a coupon row with a corrupt value as a server error', async () => {
  const { service } = buildService({
    products: CATALOG,
    coupon: { id: 5, code: 'BAD', type: 'percent', value: 500 },
  });

  await assert.rejects(
    service.createOrder({ userId: 1, items: [{ productId: 1, qty: 1 }], couponCode: 'BAD', email: null }),
    (error) => error.status === 500 && error.code === 'COUPON_MISCONFIGURED',
  );
});

test('createOrder fails with a 400 when a cart references a missing product', async () => {
  const { service } = buildService({ products: CATALOG });

  await assert.rejects(
    service.createOrder({ userId: 1, items: [{ productId: 404, qty: 1 }], couponCode: null, email: null }),
    (error) => error.status === 400,
  );
});

test('getOrder raises a 404 for an unknown order', async () => {
  const { service } = buildService({ products: CATALOG });
  await assert.rejects(service.getOrder(9999), (error) => error.status === 404);
});
