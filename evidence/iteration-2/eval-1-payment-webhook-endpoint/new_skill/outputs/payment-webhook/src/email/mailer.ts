import nodemailer from 'nodemailer';
import { config } from '../config.js';
import type { Order } from '../payments/orderRepository.js';

/**
 * สมมติว่าใช้สกุลเงินที่มีทศนิยม 2 ตำแหน่ง (THB, USD, EUR)
 * ถ้าต้องรองรับ JPY/KRW ที่ไม่มีหน่วยย่อย ต้องเพิ่มตารางค่า exponent ต่อสกุลเงิน
 */
const MINOR_UNITS_PER_MAJOR = 100;

const transporter = nodemailer.createTransport(config.SMTP_URL, {
  // ทุก network call ต้องมี timeout — ไม่งั้น SMTP ที่ค้างจะลาก request ค้างตามไปด้วย
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
});

/**
 * ส่งอีเมลยืนยันการชำระเงิน
 * โยน error ออกไปเมื่อส่งไม่สำเร็จ — ผู้เรียกเป็นคนตัดสินใจว่าจะ retry หรือแค่ log
 */
export async function sendOrderConfirmationEmail(order: Order, paymentReference: string): Promise<void> {
  const amount = formatAmount(order.amountMinorUnits, order.currency);
  await transporter.sendMail({
    from: config.MAIL_FROM,
    to: order.customerEmail,
    subject: `ยืนยันการชำระเงิน คำสั่งซื้อ ${order.id}`,
    text: buildText(order, amount, paymentReference),
    html: buildHtml(order, amount, paymentReference),
  });
}

export async function verifyMailerConnection(): Promise<void> {
  await transporter.verify();
}

export function closeMailer(): void {
  transporter.close();
}

function formatAmount(amountMinorUnits: number, currency: string): string {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency,
  }).format(amountMinorUnits / MINOR_UNITS_PER_MAJOR);
}

function buildText(order: Order, amount: string, paymentReference: string): string {
  return [
    `สวัสดีคุณ${order.customerName}`,
    '',
    'เราได้รับการชำระเงินของคุณเรียบร้อยแล้ว',
    `เลขที่คำสั่งซื้อ: ${order.id}`,
    `ยอดชำระ: ${amount}`,
    `รหัสอ้างอิงการชำระเงิน: ${paymentReference}`,
    '',
    'ขอบคุณที่ใช้บริการ',
  ].join('\n');
}

function buildHtml(order: Order, amount: string, paymentReference: string): string {
  // ข้อมูลทุกตัวที่ฝังลง HTML ต้อง escape ก่อน แม้จะมาจาก DB ของเราเอง
  // (ชื่อลูกค้าเป็นข้อความที่ผู้ใช้กรอกเข้ามา = untrusted)
  return `<!doctype html>
<html lang="th">
  <body style="font-family: sans-serif; line-height: 1.6;">
    <p>สวัสดีคุณ${escapeHtml(order.customerName)}</p>
    <p>เราได้รับการชำระเงินของคุณเรียบร้อยแล้ว</p>
    <table cellpadding="6">
      <tr><td>เลขที่คำสั่งซื้อ</td><td><strong>${escapeHtml(order.id)}</strong></td></tr>
      <tr><td>ยอดชำระ</td><td><strong>${escapeHtml(amount)}</strong></td></tr>
      <tr><td>รหัสอ้างอิงการชำระเงิน</td><td>${escapeHtml(paymentReference)}</td></tr>
    </table>
    <p>ขอบคุณที่ใช้บริการ</p>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
