'use strict';

const { ValidationError, DataIntegrityError } = require('../errors');

/**
 * กฎการคิดเงินของ order ทั้งหมดอยู่ในไฟล์นี้ไฟล์เดียว — pure function ล้วน
 * ไม่รู้จัก express, ไม่รู้จัก mysql
 *
 * ทำไมต้องแยก: กฎพวกนี้คือส่วนที่ "ผิดแล้วเสียเงินจริง" และเป็นส่วนที่ถูกขอแก้บ่อยที่สุด
 * (การตลาดขอเปลี่ยนส่วนลด, บัญชีขอเปลี่ยนค่าส่ง) การทำให้มัน test ได้โดยไม่ต้องมี DB
 * คือสิ่งที่คุ้มที่สุดของ refactor นี้
 *
 * ทำไมเป็นจำนวนเต็ม "สตางค์": ของเดิมคูณส่วนลดบน float ทำให้เศษเพี้ยนสะสม
 * (0.1 + 0.2 !== 0.3) การคิดบน integer ทำให้ผลลัพธ์กำหนดได้แน่นอนและ test ได้
 */

/** ซื้อเกินจำนวนนี้ต่อรายการ ลดราคาต่อชิ้น (ของเดิม: `qty > 10`) */
const BULK_DISCOUNT_MIN_QTY = 11;
const BULK_DISCOUNT_RATE = 0.05;

/** หมวดสินค้าที่ติดโปรโมชัน (ของเดิมเขียนเป็นเลข 3 ลอย ๆ ในโค้ด) */
const PROMO_CATEGORY_ID = 3;
const PROMO_CATEGORY_RATE = 0.1;

/** ยอดหลังหักส่วนลด "เกิน" ค่านี้ = ส่งฟรี (ของเดิม: `total > 1500`) */
const FREE_SHIPPING_THRESHOLD_MINOR = 150_000;
const SHIPPING_FEE_MINOR = 6_000;

const MINOR_UNITS_PER_MAJOR = 100;

/**
 * @typedef {object} ProductRow
 * @property {number} id
 * @property {string} name
 * @property {string|number} price ราคาหน่วยบาท — mysql2 ส่ง DECIMAL มาเป็น string
 * @property {number|null} category
 *
 * @typedef {object} CouponRow
 * @property {string} code
 * @property {string} type `percent` | อื่น ๆ = ลดเป็นจำนวนเงิน
 * @property {string|number} value
 *
 * @typedef {object} OrderItemInput
 * @property {number} productId
 * @property {number} qty
 *
 * @typedef {object} PricedLine
 * @property {number} productId
 * @property {string} name
 * @property {number} unitPriceMinor ราคาต่อชิ้นหลังส่วนลดระดับรายการ
 * @property {number} qty
 * @property {number} lineTotalMinor
 *
 * @typedef {object} PricedOrder
 * @property {PricedLine[]} lines
 * @property {number} subtotalMinor ยอดรวมหลังส่วนลดระดับรายการ ก่อนคูปอง
 * @property {number} couponDiscountMinor
 * @property {number} shippingMinor
 * @property {number} totalMinor ยอดที่ต้องจ่ายจริง
 */

/**
 * แปลงจำนวนเงินหน่วยบาท (number หรือ string จาก DECIMAL) เป็นจำนวนเต็มสตางค์
 * @param {string|number} amount
 * @param {string} context ใช้ประกอบข้อความ error ให้ debug ได้จาก log อย่างเดียว
 * @returns {number}
 */
function toMinorUnits(amount, context) {
  const parsed = typeof amount === 'string' ? Number(amount) : amount;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new DataIntegrityError(`Cannot read monetary amount for ${context}`, { amount });
  }
  if (parsed < 0) {
    throw new DataIntegrityError(`Negative monetary amount for ${context}`, { amount });
  }
  return Math.round(parsed * MINOR_UNITS_PER_MAJOR);
}

/**
 * แปลงกลับเป็นหน่วยบาทสำหรับเขียนลง column DECIMAL เดิม
 * @param {number} minor
 * @returns {number}
 */
function toMajorUnits(minor) {
  return Math.round(minor) / MINOR_UNITS_PER_MAJOR;
}

/**
 * @param {number} minor
 * @param {number} rate 0..1
 * @returns {number}
 */
function applyDiscountRate(minor, rate) {
  return Math.round(minor * (1 - rate));
}

/**
 * ส่วนลดสองชั้นทบกันแบบคูณ (ตามพฤติกรรมเดิม) — ปัดเศษครั้งเดียวที่ระดับราคาต่อชิ้น
 * @param {OrderItemInput} item
 * @param {ProductRow} product
 * @returns {PricedLine}
 */
function priceLine(item, product) {
  if (!Number.isInteger(item.qty) || item.qty <= 0) {
    throw new ValidationError(`Quantity for product ${item.productId} must be a positive integer`, {
      productId: item.productId,
      qty: item.qty,
    });
  }

  let unitPriceMinor = toMinorUnits(product.price, `product ${product.id}`);
  if (item.qty >= BULK_DISCOUNT_MIN_QTY) {
    unitPriceMinor = applyDiscountRate(unitPriceMinor, BULK_DISCOUNT_RATE);
  }
  if (product.category === PROMO_CATEGORY_ID) {
    unitPriceMinor = applyDiscountRate(unitPriceMinor, PROMO_CATEGORY_RATE);
  }

  return {
    productId: product.id,
    name: product.name,
    unitPriceMinor,
    qty: item.qty,
    lineTotalMinor: unitPriceMinor * item.qty,
  };
}

/**
 * @param {number} subtotalMinor
 * @param {CouponRow|null} coupon
 * @returns {number} ส่วนลดเป็นสตางค์ ไม่เกิน subtotal (ยอดสุทธิห้ามติดลบ)
 */
function calculateCouponDiscount(subtotalMinor, coupon) {
  if (!coupon) return 0;

  let discountMinor;
  if (coupon.type === 'percent') {
    const percent = Number(coupon.value);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new DataIntegrityError(`Coupon ${coupon.code} has an out-of-range percent value`, {
        code: coupon.code,
      });
    }
    discountMinor = Math.round((subtotalMinor * percent) / 100);
  } else if (coupon.type === 'fixed' || coupon.type === 'amount') {
    discountMinor = toMinorUnits(coupon.value, `coupon ${coupon.code}`);
  } else {
    // ของเดิมถือว่า "ไม่ใช่ percent = ลดเป็นจำนวนเงิน" ซึ่งแปลว่า type ที่พิมพ์ผิด
    // จะกลายเป็นส่วนลดเงียบ ๆ — ตรงนี้ให้ดังแทน
    throw new DataIntegrityError(`Coupon ${coupon.code} has an unknown type "${coupon.type}"`, {
      code: coupon.code,
    });
  }

  return Math.min(discountMinor, subtotalMinor);
}

/**
 * @param {number} netMinor ยอดหลังหักคูปอง
 * @returns {number}
 */
function calculateShipping(netMinor) {
  return netMinor > FREE_SHIPPING_THRESHOLD_MINOR ? 0 : SHIPPING_FEE_MINOR;
}

/**
 * @param {{ items: OrderItemInput[], productsById: Map<number, ProductRow>, coupon: CouponRow|null }} input
 * @returns {PricedOrder}
 */
function priceOrder({ items, productsById, coupon }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('Order must contain at least one item');
  }

  const lines = items.map((item) => {
    const product = productsById.get(item.productId);
    if (!product) {
      // service ควรกรองไปแล้ว — กันไว้อีกชั้นเผื่อมีคนเรียก priceOrder ตรง ๆ
      throw new ValidationError(`Unknown product ${item.productId}`, { productId: item.productId });
    }
    return priceLine(item, product);
  });

  const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const couponDiscountMinor = calculateCouponDiscount(subtotalMinor, coupon);
  const netMinor = subtotalMinor - couponDiscountMinor;
  const shippingMinor = calculateShipping(netMinor);

  return {
    lines,
    subtotalMinor,
    couponDiscountMinor,
    shippingMinor,
    totalMinor: netMinor + shippingMinor,
  };
}

// export เฉพาะที่มีผู้เรียกจริง — ฟังก์ชันย่อยที่เหลือเป็นรายละเอียดภายในของกฎคิดเงิน
module.exports = {
  priceOrder,
  toMajorUnits,
  FREE_SHIPPING_THRESHOLD_MINOR,
  SHIPPING_FEE_MINOR,
};
