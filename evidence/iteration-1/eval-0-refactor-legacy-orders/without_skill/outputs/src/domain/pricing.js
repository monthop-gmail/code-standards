'use strict';

const { AppError } = require('../errors/AppError');
const { toMinorUnits, applyRate, atLeastZero, assertInteger } = require('./money');

/**
 * Pure pricing rules. No database, no Express, no I/O — this module is the
 * part of the system that is worth unit-testing exhaustively, and in the
 * legacy file it was tangled up with SQL string building.
 *
 * The magic numbers from the original (10, 0.95, 3, 0.9, 1500, 60) are named
 * here so the business rules are legible and changeable in one place.
 */
const PRICING_RULES = Object.freeze({
  /** Buying more than this many units of a line earns the bulk discount. */
  bulkQuantityThreshold: 10,
  /** 5% off the unit price for bulk lines. */
  bulkDiscountRate: 0.05,
  /** Category IDs that carry a permanent promotional discount. */
  discountedCategoryIds: Object.freeze([3]),
  /** 10% off the unit price for those categories. */
  categoryDiscountRate: 0.1,
  /** Orders at or above this subtotal ship free. */
  freeShippingThreshold: 150000, // 1,500.00
  /** Flat shipping fee applied below the threshold. */
  shippingFee: 6000, // 60.00
});

/**
 * Unit price after per-line discounts.
 * Bulk and category discounts stack multiplicatively, matching legacy behaviour.
 *
 * @param {number} unitPrice integer minor units
 * @param {{ qty: number, categoryId: number }} context
 * @returns {number} discounted unit price in integer minor units
 */
function discountedUnitPrice(unitPrice, { qty, categoryId }, rules = PRICING_RULES) {
  assertInteger(unitPrice);
  let price = unitPrice;

  if (qty > rules.bulkQuantityThreshold) {
    price -= applyRate(price, rules.bulkDiscountRate);
  }
  if (rules.discountedCategoryIds.includes(categoryId)) {
    price -= applyRate(price, rules.categoryDiscountRate);
  }
  return atLeastZero(price);
}

/**
 * Build priced order lines and their subtotal.
 *
 * @param {Array<{productId: number, qty: number}>} items requested cart items
 * @param {Map<number, {id:number,name:string,price:any,category:number}>} productsById
 * @returns {{ lines: Array<object>, subtotal: number }}
 */
function priceLines(items, productsById, rules = PRICING_RULES) {
  const lines = [];
  let subtotal = 0;

  for (const item of items) {
    const product = productsById.get(item.productId);
    if (!product) {
      // The legacy code did `rows[0].price` on an empty result and crashed
      // with "cannot read property of undefined" -> a 200 {ok:false}.
      throw AppError.badRequest(`Product ${item.productId} does not exist.`, {
        productId: item.productId,
      });
    }

    const unitPrice = discountedUnitPrice(
      toMinorUnits(product.price),
      { qty: item.qty, categoryId: product.category },
      rules,
    );
    const lineTotal = unitPrice * item.qty;
    subtotal += lineTotal;

    lines.push({
      productId: product.id,
      name: product.name,
      unitPrice,
      qty: item.qty,
      lineTotal,
    });
  }

  return { lines, subtotal };
}

/**
 * Apply a validated coupon to a subtotal. Never returns a negative amount:
 * the legacy code happily produced a negative total for a fixed-value coupon
 * larger than the cart, which would then be inserted into `orders.total`.
 *
 * @param {number} subtotal integer minor units
 * @param {{type:'percent'|'fixed', value:number}|null} coupon
 * @returns {{ total: number, discount: number }}
 */
function applyCoupon(subtotal, coupon) {
  assertInteger(subtotal);
  if (!coupon) return { total: subtotal, discount: 0 };

  let discount;
  if (coupon.type === 'percent') {
    discount = applyRate(subtotal, coupon.value / 100);
  } else if (coupon.type === 'fixed') {
    discount = toMinorUnits(coupon.value);
  } else {
    throw new AppError('INVALID_COUPON_TYPE', `Unsupported coupon type "${coupon.type}".`, 500);
  }

  discount = Math.min(discount, subtotal); // never discount below zero
  return { total: subtotal - discount, discount };
}

/**
 * Shipping fee for a given post-discount total.
 * Legacy had a no-op `total = total` branch; the intent was free shipping
 * above the threshold, which is what this expresses.
 */
function shippingFeeFor(total, rules = PRICING_RULES) {
  assertInteger(total);
  return total >= rules.freeShippingThreshold ? 0 : rules.shippingFee;
}

/**
 * Full quote for an order: lines, subtotal, coupon discount, shipping, total.
 *
 * @returns {{lines:Array<object>, subtotal:number, discount:number, shipping:number, total:number}}
 */
function quoteOrder({ items, productsById, coupon = null }, rules = PRICING_RULES) {
  const { lines, subtotal } = priceLines(items, productsById, rules);
  const { total: afterCoupon, discount } = applyCoupon(subtotal, coupon);
  const shipping = shippingFeeFor(afterCoupon, rules);

  return {
    lines,
    subtotal,
    discount,
    shipping,
    total: atLeastZero(afterCoupon + shipping),
  };
}

module.exports = {
  PRICING_RULES,
  discountedUnitPrice,
  priceLines,
  applyCoupon,
  shippingFeeFor,
  quoteOrder,
};
