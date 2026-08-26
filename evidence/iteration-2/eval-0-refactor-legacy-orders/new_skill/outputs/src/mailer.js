'use strict';

/** อีเมลยืนยันคือ dependency รอง — ระบบสั่งซื้อต้องทำงานต่อได้แม้ผู้ให้บริการเมลล่ม */

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * ส่งอีเมลยืนยันคำสั่งซื้อ
 *
 * ไม่เคย throw โดยตั้งใจ: order commit ไปแล้ว การส่งเมลไม่สำเร็จจึงต้องไม่ทำให้
 * ลูกค้าเห็น error หรือกดสั่งซ้ำ แต่ก็ไม่กลืนเงียบ — ทุกความล้มเหลวถูก log พร้อม
 * orderId ให้ตามเก็บทีหลังได้ และคืนค่าบอกผู้เรียกว่าส่งได้หรือไม่
 *
 * @param {{ to: string, orderId: number }} args
 * @returns {Promise<boolean>} true เมื่อผู้ให้บริการตอบรับ
 */
async function sendOrderConfirmation({ to, orderId }) {
  const endpoint = process.env.MAIL_API_URL;
  const apiKey = process.env.MAIL_API_KEY;

  if (!endpoint || !apiKey) {
    console.error(
      JSON.stringify({
        event: 'order_confirmation_skipped',
        reason: 'MAIL_API_URL or MAIL_API_KEY is not configured',
        orderId,
      }),
    );
    return false;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ to, tpl: 'order_confirm', orderId }),
      signal: AbortSignal.timeout(Number(process.env.MAIL_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)),
    });

    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: 'order_confirmation_failed',
          orderId,
          status: response.status,
        }),
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'order_confirmation_failed',
        orderId,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
    return false;
  }
}

module.exports = { sendOrderConfirmation };
