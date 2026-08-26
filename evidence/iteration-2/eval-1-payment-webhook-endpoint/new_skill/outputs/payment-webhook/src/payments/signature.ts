import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * รูปแบบ header ที่รองรับ: `t=<unix seconds>,v1=<hex hmac sha256>`
 * โดย signed payload คือ `<t>.<raw request body>` (แบบเดียวกับ Stripe / Omise)
 *
 * ถ้า gateway ที่ใช้จริงเซ็นด้วยสูตรอื่น ให้แก้เฉพาะไฟล์นี้ไฟล์เดียว —
 * ที่เหลือของระบบไม่รู้จักรูปแบบ signature เลย
 */
const SIGNATURE_VERSION_KEY = 'v1';
const TIMESTAMP_KEY = 't';
const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const UNIX_SECONDS_PATTERN = /^\d{1,12}$/;

export type SignatureFailureReason =
  | 'missing_header'
  | 'malformed_header'
  | 'timestamp_out_of_tolerance'
  | 'signature_mismatch';

export type SignatureVerification =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: SignatureFailureReason };

export interface VerifyWebhookSignatureParams {
  /** raw bytes ของ body — ต้องเป็นไบต์ที่ได้รับมาจริง ห้าม JSON.stringify ใหม่ */
  readonly payload: Buffer;
  readonly header: string | undefined;
  readonly secret: string;
  /** ช่วงเวลาที่ยอมรับได้ของ timestamp บน header — กัน replay attack */
  readonly toleranceSeconds: number;
  readonly now?: Date;
}

/**
 * ตรวจ signature ของ webhook ก่อนแตะ payload ใด ๆ
 * payload ที่ยังไม่ verify = ใครส่งมาก็ได้ ห้ามเอาไปตัดสินใจเรื่องเงินเด็ดขาด
 */
export function verifyWebhookSignature(params: VerifyWebhookSignatureParams): SignatureVerification {
  const { payload, header, secret, toleranceSeconds, now = new Date() } = params;

  if (header === undefined || header.trim() === '') {
    return { valid: false, reason: 'missing_header' };
  }

  const parsed = parseSignatureHeader(header);
  if (parsed === null) {
    return { valid: false, reason: 'malformed_header' };
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    return { valid: false, reason: 'timestamp_out_of_tolerance' };
  }

  // ต่อ `<t>.` กับ raw bytes โดยไม่แปลง payload เป็น string
  // เพื่อไม่ให้ encoding ทำให้ไบต์เปลี่ยน (อักษรไทย/emoji ใน body)
  const expected = createHmac('sha256', secret)
    .update(`${parsed.timestamp}.`)
    .update(payload)
    .digest();

  if (expected.length !== parsed.signature.length) {
    return { valid: false, reason: 'signature_mismatch' };
  }
  if (!timingSafeEqual(expected, parsed.signature)) {
    return { valid: false, reason: 'signature_mismatch' };
  }
  return { valid: true };
}

function parseSignatureHeader(header: string): { timestamp: number; signature: Buffer } | null {
  let timestamp: number | null = null;
  let signatureHex: string | null = null;

  for (const part of header.split(',')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (key === TIMESTAMP_KEY && UNIX_SECONDS_PATTERN.test(value)) {
      timestamp = Number(value);
    } else if (key === SIGNATURE_VERSION_KEY && HEX_SHA256_PATTERN.test(value)) {
      signatureHex = value;
    }
  }

  if (timestamp === null || signatureHex === null) return null;
  return { timestamp, signature: Buffer.from(signatureHex, 'hex') };
}

/**
 * ใช้ในเทสต์และในสคริปต์ยิง webhook ปลอมตอน dev
 * (production ไม่เรียก — ฝั่งที่เซ็นคือ payment gateway)
 */
export function signWebhookPayload(payload: Buffer, secret: string, timestampSeconds: number): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestampSeconds}.`)
    .update(payload)
    .digest('hex');
  return `t=${timestampSeconds},v1=${signature}`;
}
