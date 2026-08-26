'use strict';

/**
 * Error ทั้งแอปสืบทอดจาก AppError ตัวเดียว เพื่อให้ error handler ที่ขอบระบบ
 * แยกได้ว่าอันไหนคือ "ความผิดพลาดที่คาดไว้แล้ว" (ตอบ client ตรง ๆ ได้)
 * กับอันไหนคือ bug/infra ล่ม (ต้องกลบรายละเอียดก่อนตอบ แล้ว log เต็ม)
 */
class AppError extends Error {
  /**
   * @param {string} message ข้อความสำหรับ client — ห้ามใส่ SQL, stack, ชื่อ host ภายใน
   * @param {{ code: string, status: number, details?: unknown, cause?: unknown }} options
   */
  constructor(message, { code, status, details, cause }) {
    super(message, { cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
    /** บอก error handler ว่าเปิดเผยข้อความนี้ให้ client ได้ */
    this.expected = true;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** input จากภายนอกไม่ผ่านกฎ — 422 เพราะ syntax ถูกแต่ค่าไม่ผ่านกฎธุรกิจ */
class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { code: 'VALIDATION_ERROR', status: 422, details });
  }
}

class NotFoundError extends AppError {
  constructor(message, code = 'NOT_FOUND') {
    super(message, { code, status: 404 });
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, { code: 'UNAUTHORIZED', status: 401 });
  }
}

/**
 * ข้อมูลใน DB อยู่ในสภาพที่โค้ดคิดเงินต่อไม่ได้ (เช่น coupon.type เป็นค่าที่ไม่รู้จัก)
 * ไม่ใช่ความผิดของ client → 500 และต้องดังพอให้มีคนไปแก้ข้อมูล
 */
class DataIntegrityError extends AppError {
  constructor(message, details) {
    super(message, { code: 'DATA_INTEGRITY_ERROR', status: 500, details });
    this.expected = false;
  }
}

/** config/env ไม่ครบตอน boot — ต้องล้มตั้งแต่ startup ไม่ใช่ตอน request แรก */
class ConfigurationError extends AppError {
  constructor(message) {
    super(message, { code: 'CONFIGURATION_ERROR', status: 500 });
    this.expected = false;
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  DataIntegrityError,
  ConfigurationError,
};
