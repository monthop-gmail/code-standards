'use strict';

const config = require('./config');
const { createPool } = require('./db/pool');
const { ProductRepository } = require('./repositories/productRepository');
const { CouponRepository } = require('./repositories/couponRepository');
const { OrderRepository } = require('./repositories/orderRepository');
const { NotificationService } = require('./services/notificationService');
const { OrderService } = require('./services/orderService');
const { createOrdersRouter } = require('./http/routes/orders');

/**
 * Composition root: the one place that knows how the pieces fit together.
 * Everything else receives its collaborators, which is what makes the
 * services testable with fakes.
 */
function buildContainer(overrides = {}) {
  const settings = overrides.config ?? config.load();
  const pool = overrides.pool ?? createPool(settings.db);

  const productRepository = new ProductRepository(pool);
  const couponRepository = new CouponRepository(pool);
  const orderRepository = new OrderRepository(pool);
  const notificationService = new NotificationService(settings.mailer);

  const orderService = new OrderService({
    pool,
    productRepository,
    couponRepository,
    orderRepository,
    notificationService,
  });

  return {
    config: settings,
    pool,
    orderService,
    ordersRouter: createOrdersRouter({ orderService, limits: settings.limits }),
  };
}

module.exports = { buildContainer };
