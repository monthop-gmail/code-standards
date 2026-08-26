'use strict';

const MINOR_UNITS_PER_MAJOR = 100;

/**
 * แปลงค่าเงินให้เป็นจำนวนเต็มหน่วยย่อย (สตางค์)
 *
 * ทำไมต้องแปลง: mysql2 คืนค่า DECIMAL มาเป็น string และการคูณส่วนลดด้วย float
 * (0.95 * 0.9) ทำให้ยอดเพี้ยนระดับเศษสตางค์แล้วสะสมข้ามบรรทัดจนยอดรวมไม่ตรงกับใบเสร็จ
 * คิดเงินทั้งหมดด้วย integer แล้วค่อยแปลงกลับตอนจะเก็บ/ตอบ client
 *
 * @param {string|number} value
 * @param {string} [label] - ใช้ประกอบข้อความ error ตอนเจอค่าที่แปลงไม่ได้
 * @returns {number} จำนวนเต็มหน่วยย่อย
 */
function toMinorUnits(value, label = 'amount') {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new TypeError(`${label} is not a valid monetary value: ${String(value)}`);
  }
  return Math.round(parsed * MINOR_UNITS_PER_MAJOR);
}

/**
 * แปลงกลับเป็นหน่วยหลัก (บาท) สำหรับเก็บลงคอลัมน์ DECIMAL เดิมและตอบกลับ client
 * @param {number} minor
 * @returns {number}
 */
function toMajorUnits(minor) {
  if (!Number.isInteger(minor)) {
    throw new TypeError(`expected integer minor units, got: ${String(minor)}`);
  }
  return minor / MINOR_UNITS_PER_MAJOR;
}

module.exports = { toMinorUnits, toMajorUnits };
