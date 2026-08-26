'use strict';

/**
 * Structured logging แบบบรรทัดละ JSON เพื่อให้ query ได้ใน log aggregator
 *
 * ผู้เรียกต้องไม่ส่ง password / token / เลขบัตร / อีเมลเต็ม เข้ามาใน meta
 * (ของเดิม `console.log('order created', orderId, req.body)` log ทั้ง body รวมอีเมลลูกค้า)
 */
const logger = {
  /**
   * @param {string} event
   * @param {object} [meta]
   */
  info(event, meta = {}) {
    process.stdout.write(`${JSON.stringify({ level: 'info', event, ts: new Date().toISOString(), ...meta })}\n`);
  },
  /**
   * @param {string} event
   * @param {object} [meta]
   */
  error(event, meta = {}) {
    process.stderr.write(`${JSON.stringify({ level: 'error', event, ts: new Date().toISOString(), ...meta })}\n`);
  },
};

module.exports = { logger };
