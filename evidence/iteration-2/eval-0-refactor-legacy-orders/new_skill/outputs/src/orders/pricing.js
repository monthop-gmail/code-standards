'use strict';

const { toMinorUnits } = require('../money');

/**
 * กติกาคิดราคาทั้งหมดของ order — pure function ล้วน ไม่รู้จัก DB / HTTP
 * แยกไว้ไฟล์เดียวเพราะนี่คือส่วนที่ฝ่ายธุรกิจขอแก้บ่อยที่สุดและผิดแล้วเสียเงินจริง
 * และเพราะแบบนี้จึง test ได้โดยไม่ต้องมี database
 */

/** ซื้อเกินจำนวนนี้ (มากกว่า ไม่ใช่เท่ากับ) ได้ส่วนลดต่อหน่วย */
const BULK_QTY_THRESHOLD = 10;
const BULK_DISCOUNT_RATE = 0.05;

/** หมวดสินค้าที่ตั้งโปรลดราคาไว้ (เดิม hardcode เป็นเลข 3 กลางโค้ด) */
const PROMO_CATEGORY_ID = 3;
const PROMO_CATEGORY_DISCOUNT_RATE = 0.1;

/** ยอดหลังหักคูปองเกินค่านี้ (มากกว่า ไม่ใช่เท่ากับ) = ส่งฟรี */
const FREE_SHIPPING_THRESHOLD_MINOR = 150_000;
const SHIPPING_FEE_MINOR = 6_000;

/**
 * @typedef {object} PricedProduct
 * @property {number} id
 * @property {string} name
 * @property {number} unitPriceMinor - ราคาตั้งต่อหน่วย หน่วยย่อย
 * @property {number} categoryId
 */

/**
 * @typedef {object} OrderItemInput
 * @property {number} productId
 * @property {number} qty
 */

/**
 * @typedef {object} Coupon
 * @property {string} code
 * @property {string} type - 'percent' = ลดเป็นเปอร์เซ็นต์, ค่าอื่นทั้งหมด = ลดเป็นจำนวนเงิน
 * @property {number} value - เปอร์เซ็นต์ (0-100) หรือจำนวนเงินหน่วยหลัก ตาม type
 */

/**
 * @typedef {object} QuoteLine
 * @property {number} productId
 * @property {string} name
 * @property {number} unitPriceMinor - ราคาต่อหน่วย "หลังหักส่วนลดระดับสินค้า"
 * @property {number} qty
 * @property {number} subtotalMinor
 */

/**
 * @typedef {object} Quote
 * @property {QuoteLine[]} lines
 * @property {number} itemsTotalMinor
 * @property {number} discountMinor
 * @property {number} shippingMinor
 * @property {number} totalMinor
 */

/**
 * ราคาต่อหน่วยหลังหักส่วนลดระดับสินค้า
 *
 * ส่วนลดสองตัวคิดทบกัน (ซื้อเยอะ แล้วค่อยหมวดโปร) ตามลำดับเดิมของระบบ —
 * ซื้อ >10 ชิ้นในหมวด 3 จึงได้ 0.95 * 0.9 = 85.5% ของราคาตั้ง ไม่ใช่ 85%
 * ปัดเศษที่ระดับ "ต่อหน่วย" เพราะราคานี้ถูกเก็บลง order_items.unit_price จริง
 *
 * @param {PricedProduct} product
 * @param {number} qty
 * @returns {number} หน่วยย่อย
 */
function discountedUnitPrice(product, qty) {
  let priceMinor = product.unitPriceMinor;
  if (qty > BULK_QTY_THRESHOLD) {
    priceMinor = Math.round(priceMinor * (1 - BULK_DISCOUNT_RATE));
  }
  if (product.categoryId === PROMO_CATEGORY_ID) {
    priceMinor = Math.round(priceMinor * (1 - PROMO_CATEGORY_DISCOUNT_RATE));
  }
  return priceMinor;
}

/**
 * ส่วนลดจากคูปอง โดยไม่ให้เกินยอดสินค้า
 *
 * type ที่ไม่ใช่ 'percent' ถือเป็นส่วนลดจำนวนเงิน — คงพฤติกรรมเดิมของระบบไว้
 * (ดูข้อเสนอเรื่องบังคับ ENUM ที่ฝั่ง DB ใน RESPONSE.md)
 *
 * @param {Coupon} coupon
 * @param {number} itemsTotalMinor
 * @returns {number} หน่วยย่อย, 0 <= ผลลัพธ์ <= itemsTotalMinor
 */
function couponDiscount(coupon, itemsTotalMinor) {
  const rawDiscountMinor =
    coupon.type === 'percent'
      ? Math.round((itemsTotalMinor * clamp(coupon.value, 0, 100)) / 100)
      : toMinorUnits(coupon.value, `coupon ${coupon.code} value`);
  return clamp(rawDiscountMinor, 0, itemsTotalMinor);
}

/**
 * คิดยอดทั้งใบ: ราคาต่อบรรทัด → รวม → หักคูปอง → บวกค่าส่ง
 *
 * ค่าส่งคิดจากยอด "หลังหักคูปอง" ตามระบบเดิม — คูปองจึงทำให้ตะกร้าที่เกือบถึง
 * เกณฑ์ส่งฟรีตกกลับมาเสียค่าส่งได้ ซึ่งเป็นพฤติกรรมที่ตั้งใจคงไว้ ไม่ใช่บั๊กที่ลืมแก้
 *
 * @param {{ items: OrderItemInput[], products: Map<number, PricedProduct>, coupon: Coupon|null }} args
 * @returns {Quote}
 */
function quoteOrder({ items, products, coupon }) {
  const lines = items.map((item) => {
    const product = products.get(item.productId);
    if (!product) {
      throw new Error(`quoteOrder called without product ${item.productId}`);
    }
    const unitPriceMinor = discountedUnitPrice(product, item.qty);
    return {
      productId: product.id,
      name: product.name,
      unitPriceMinor,
      qty: item.qty,
      subtotalMinor: unitPriceMinor * item.qty,
    };
  });

  const itemsTotalMinor = lines.reduce((sum, line) => sum + line.subtotalMinor, 0);
  const discountMinor = coupon ? couponDiscount(coupon, itemsTotalMinor) : 0;
  const discountedTotalMinor = itemsTotalMinor - discountMinor;
  const shippingMinor =
    discountedTotalMinor > FREE_SHIPPING_THRESHOLD_MINOR ? 0 : SHIPPING_FEE_MINOR;

  return {
    lines,
    itemsTotalMinor,
    discountMinor,
    shippingMinor,
    totalMinor: discountedTotalMinor + shippingMinor,
  };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

module.exports = { quoteOrder, discountedUnitPrice };
