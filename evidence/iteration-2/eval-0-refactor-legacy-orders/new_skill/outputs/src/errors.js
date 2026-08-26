'use strict';

/**
 * Error ที่ "คาดไว้แล้ว" ของชั้น application — พกสถานะ HTTP และรหัสที่ client ใช้แยกเคสได้
 *
 * ใช้คลาสเดียวแทนการทำ hierarchy ย่อย เพราะทุกจุดที่ catch ต้องการข้อมูลชุดเดียวกัน
 * (status + code) และยังไม่มีใครต้อง catch แยกชนิด — ถ้าวันหนึ่งมี ค่อยแตกทีหลัง
 */
class AppError extends Error {
  /**
   * @param {string} code - รหัสคงที่สำหรับ client เช่น 'VALIDATION_ERROR'
   * @param {string} message - ข้อความที่ปลอดภัยพอจะส่งออกไปหา client
   * @param {number} status - HTTP status
   * @param {Record<string, unknown>} [details] - ข้อมูลเสริมที่ปลอดภัยจะเปิดเผย (เช่น field ที่ผิด)
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, status, details, options) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

module.exports = { AppError };
