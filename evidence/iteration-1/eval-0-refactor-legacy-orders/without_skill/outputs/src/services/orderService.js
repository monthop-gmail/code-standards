'use strict';

const { AppError } = require('../errors/AppError');
const { withTransaction } = require('../db/transaction');
const { quoteOrder } = require('../domain/pricing');
const { toMajorUnits, toMinorUnits } = require('../domain/money');
const logger = require('../lib/logger');

const VALID_COUPON_TYPES = new Set(['percent', 'fixed']);

/**
 * Use-case layer for orders. Owns the workflow (price -> persist -> notify)
 * and knows nothing about HTTP; the route translates its results and errors.
 */
class OrderService {
  /**
   * @param {object} deps
   * @param {import('mysql2/promise').Pool} deps.pool
   * @param {import('../repositories/productRepository').ProductRepository} deps.productRepository
   * @param {import('../repositories/couponRepository').CouponRepository} deps.couponRepository
   * @param {import('../repositories/orderRepository').OrderRepository} deps.orderRepository
   * @param {import('./notificationService').NotificationService} deps.notificationService
   */
  constructor({ pool, productRepository, couponRepository, orderRepository, notificationService }) {
    this.pool = pool;
    this.products = productRepository;
    this.coupons = couponRepository;
    this.orders = orderRepository;
    this.notifications = notificationService;
  }

  /**
   * Create an order.
   *
   * @param {{userId:number, items:Array<{productId:number,qty:number}>, couponCode:string|null, email:string|null}} input
   * @returns {Promise<{orderId:number, subtotal:number, discount:number, shipping:number, total:number, items:Array<object>}>}
   */
  async createOrder({ userId, items, couponCode, email }) {
    const productsById = await this.products.findByIds(items.map((item) => item.productId));
    const coupon = await this.resolveCoupon(couponCode);
    const quote = quoteOrder({ items, productsById, coupon });

    const orderId = await withTransaction(this.pool, async (connection) => {
      const orders = this.orders.withConnection(connection);
      const id = await orders.createOrder({
        userId,
        totalMinor: quote.total,
        status: 'new',
      });
      await orders.createOrderItems(id, quote.lines);
      return id;
    });

    logger.info('order.created', {
      orderId,
      userId,
      lineCount: quote.lines.length,
      totalMinor: quote.total,
    });

    // Fire-and-forget: the order is already durable, so a mail failure is
    // reported but does not affect the response.
    await this.notifications.sendOrderConfirmation({ to: email, orderId });

    return {
      orderId,
      subtotal: toMajorUnits(quote.subtotal),
      discount: toMajorUnits(quote.discount),
      shipping: toMajorUnits(quote.shipping),
      total: toMajorUnits(quote.total),
      items: quote.lines.map((line) => ({
        productId: line.productId,
        name: line.name,
        unitPrice: toMajorUnits(line.unitPrice),
        qty: line.qty,
      })),
    };
  }

  /**
   * Resolve and sanity-check a coupon code.
   * An unknown code is rejected explicitly instead of being silently ignored,
   * so a customer who mistypes a code finds out before they are charged.
   */
  async resolveCoupon(couponCode) {
    if (!couponCode) return null;

    const coupon = await this.coupons.findRedeemableByCode(couponCode);
    if (!coupon) {
      throw AppError.badRequest('Coupon code is not valid or has expired.', {
        field: 'coupon',
      });
    }
    if (!VALID_COUPON_TYPES.has(coupon.type)) {
      // Bad data in our own table: a server-side problem, not the caller's.
      logger.error('coupon.invalid_type', { couponId: coupon.id, type: coupon.type });
      throw new AppError('COUPON_MISCONFIGURED', 'Coupon could not be applied.', 500);
    }

    const value = Number(coupon.value);
    if (!Number.isFinite(value) || value < 0 || (coupon.type === 'percent' && value > 100)) {
      logger.error('coupon.invalid_value', { couponId: coupon.id, value: coupon.value });
      throw new AppError('COUPON_MISCONFIGURED', 'Coupon could not be applied.', 500);
    }

    return { type: coupon.type, value };
  }

  /**
   * Fetch an order with its item lines.
   *
   * @param {number} orderId
   * @returns {Promise<object>}
   */
  async getOrder(orderId) {
    const order = await this.orders.findById(orderId);
    if (!order) {
      throw AppError.notFound(`Order ${orderId} was not found.`);
    }

    const items = await this.orders.findItemsByOrderId(orderId);
    // One lookup for all names instead of the legacy per-item query.
    const namesById = await this.products.findNamesByIds(items.map((item) => item.product_id));

    return {
      id: order.id,
      userId: order.user_id,
      status: order.status,
      total: toMajorUnits(toMinorUnits(order.total)),
      createdAt: order.created_at,
      items: items.map((item) => ({
        productId: item.product_id,
        name: namesById.get(item.product_id) ?? null,
        qty: item.qty,
        unitPrice: toMajorUnits(toMinorUnits(item.unit_price)),
      })),
    };
  }
}

module.exports = { OrderService };
