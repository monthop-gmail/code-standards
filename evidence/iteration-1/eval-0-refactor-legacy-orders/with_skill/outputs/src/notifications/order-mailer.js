'use strict';

/**
 * Client ของ mail service — แยกออกมาเพราะ service ไม่ควรรู้ว่าอีเมลส่งผ่าน HTTP หรืออะไร
 * และเพื่อให้ test ของ order flow ไม่ต้องยิงเน็ตจริง
 *
 * ใช้ `fetch` ที่ติดมากับ Node 18+ — ของเดิม `require('node-fetch')` อยู่กลาง request handler
 * ซึ่งทั้งเพิ่ม dependency ที่ไม่จำเป็นและซ่อน I/O ไว้ในโค้ดที่อ่านผ่าน ๆ ไม่เห็น
 *
 * @param {{ apiUrl: string, apiKey: string, timeoutMs: number }} config
 */
function createOrderMailer({ apiUrl, apiKey, timeoutMs }) {
  /**
   * @param {{ to: string, orderId: number }} input
   * @returns {Promise<void>}
   * @throws {Error} เมื่อ mail service ตอบไม่สำเร็จ — ผู้เรียกเป็นคนตัดสินใจว่าจะ degrade ยังไง
   */
  async function sendOrderConfirmation({ to, orderId }) {
    // external call ทุกอันต้องมี timeout ไม่งั้น mail service ที่ค้างจะลาก request ของเราค้างตาม
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ to, tpl: 'order_confirm', orderId }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Mail service responded with status ${response.status} for order ${orderId}`);
    }
  }

  return { sendOrderConfirmation };
}

module.exports = { createOrderMailer };
