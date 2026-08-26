import { describe, expect, it } from 'vitest';
import { signWebhookPayload, verifyWebhookSignature } from '../src/payments/signature.js';

const SECRET = 'test-secret-at-least-16-chars';
const TOLERANCE_SECONDS = 300;
const NOW = new Date('2026-08-26T10:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function verify(payload: Buffer, header: string | undefined, secret = SECRET) {
  return verifyWebhookSignature({
    payload,
    header,
    secret,
    toleranceSeconds: TOLERANCE_SECONDS,
    now: NOW,
  });
}

describe('verifyWebhookSignature', () => {
  const payload = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'payment.succeeded' }), 'utf8');

  it('ยอมรับ signature ที่เซ็นด้วย secret เดียวกันและ timestamp ปัจจุบัน', () => {
    const header = signWebhookPayload(payload, SECRET, NOW_SECONDS);
    expect(verify(payload, header)).toEqual({ valid: true });
  });

  it('ยอมรับ payload ที่มีอักษรไทยและ emoji (เทียบระดับไบต์ ไม่ใช่ string)', () => {
    const thaiPayload = Buffer.from(JSON.stringify({ name: 'สมชาย 🎉', amount: 12_345 }), 'utf8');
    const header = signWebhookPayload(thaiPayload, SECRET, NOW_SECONDS);
    expect(verify(thaiPayload, header)).toEqual({ valid: true });
  });

  it('ปฏิเสธเมื่อ payload ถูกแก้หลังเซ็น', () => {
    const header = signWebhookPayload(payload, SECRET, NOW_SECONDS);
    const tampered = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'payment.failed' }), 'utf8');
    expect(verify(tampered, header)).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('ปฏิเสธเมื่อเซ็นด้วย secret คนละตัว', () => {
    const header = signWebhookPayload(payload, 'another-secret-value-1234', NOW_SECONDS);
    expect(verify(payload, header)).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('ปฏิเสธเมื่อไม่มี header หรือ header ว่าง', () => {
    expect(verify(payload, undefined)).toEqual({ valid: false, reason: 'missing_header' });
    expect(verify(payload, '   ')).toEqual({ valid: false, reason: 'missing_header' });
  });

  it('ปฏิเสธ header ที่รูปแบบไม่ถูกต้อง', () => {
    const validHeader = signWebhookPayload(payload, SECRET, NOW_SECONDS);
    const signatureOnly = validHeader.split(',')[1] ?? '';

    expect(verify(payload, 'garbage')).toEqual({ valid: false, reason: 'malformed_header' });
    expect(verify(payload, signatureOnly)).toEqual({ valid: false, reason: 'malformed_header' });
    expect(verify(payload, `t=${NOW_SECONDS}`)).toEqual({ valid: false, reason: 'malformed_header' });
    expect(verify(payload, `t=${NOW_SECONDS},v1=not-hex`)).toEqual({ valid: false, reason: 'malformed_header' });
    expect(verify(payload, `t=abc,v1=${'a'.repeat(64)}`)).toEqual({ valid: false, reason: 'malformed_header' });
  });

  it('ปฏิเสธ signature ที่ timestamp เก่าเกิน tolerance (กัน replay)', () => {
    const oldTimestamp = NOW_SECONDS - TOLERANCE_SECONDS - 1;
    const header = signWebhookPayload(payload, SECRET, oldTimestamp);
    expect(verify(payload, header)).toEqual({ valid: false, reason: 'timestamp_out_of_tolerance' });
  });

  it('ปฏิเสธ signature ที่ timestamp ล้ำอนาคตเกิน tolerance', () => {
    const futureTimestamp = NOW_SECONDS + TOLERANCE_SECONDS + 1;
    const header = signWebhookPayload(payload, SECRET, futureTimestamp);
    expect(verify(payload, header)).toEqual({ valid: false, reason: 'timestamp_out_of_tolerance' });
  });

  it('ยอมรับ clock skew ที่ยังอยู่ในขอบเขต tolerance พอดี', () => {
    const edgeTimestamp = NOW_SECONDS - TOLERANCE_SECONDS;
    const header = signWebhookPayload(payload, SECRET, edgeTimestamp);
    expect(verify(payload, header)).toEqual({ valid: true });
  });

  it('รองรับ body ว่าง', () => {
    const empty = Buffer.alloc(0);
    const header = signWebhookPayload(empty, SECRET, NOW_SECONDS);
    expect(verify(empty, header)).toEqual({ valid: true });
  });
});
