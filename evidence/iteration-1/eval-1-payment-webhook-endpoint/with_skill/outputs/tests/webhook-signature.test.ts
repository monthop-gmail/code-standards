import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { buildSignatureHeader, verifyWebhookSignature } from '../src/webhook/signature.js';

const SECRET = 'test-secret-that-is-long-enough-000000';
const NOW = new Date('2026-08-24T10:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const BODY = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'payment.succeeded' }), 'utf8');

function verify(header: string | undefined, body: Buffer = BODY, now: Date = NOW) {
  return verifyWebhookSignature({
    rawBody: body,
    header,
    secret: SECRET,
    toleranceSeconds: 300,
    now,
  });
}

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed payload', () => {
    expect(verify(buildSignatureHeader(BODY, SECRET, NOW_SECONDS))).toEqual({ ok: true });
  });

  it('accepts a delivery signed with a slightly fast gateway clock', () => {
    const header = buildSignatureHeader(BODY, SECRET, NOW_SECONDS + 120);
    expect(verify(header)).toEqual({ ok: true });
  });

  it('rejects a body modified after signing', () => {
    const header = buildSignatureHeader(BODY, SECRET, NOW_SECONDS);
    const tampered = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'payment.failed' }), 'utf8');
    expect(verify(header, tampered)).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects a signature made with a different secret', () => {
    const digest = createHmac('sha256', 'another-secret').update(`${NOW_SECONDS}.`).update(BODY).digest('hex');
    expect(verify(`t=${NOW_SECONDS},v1=${digest}`)).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects a replayed delivery outside the tolerance window', () => {
    const header = buildSignatureHeader(BODY, SECRET, NOW_SECONDS - 301);
    expect(verify(header)).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
  });

  it('rejects a timestamp moved outside the window without re-signing', () => {
    const header = buildSignatureHeader(BODY, SECRET, NOW_SECONDS);
    const now = new Date(NOW.getTime() + 3_600_000);
    expect(verify(header, BODY, now)).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
  });

  it('reports a missing header separately from a wrong one', () => {
    expect(verify(undefined)).toEqual({ ok: false, reason: 'missing_header' });
  });

  it.each([
    ['empty', ''],
    ['no scheme parts', 'garbage'],
    ['timestamp only', `t=${NOW_SECONDS}`],
    ['signature only', 'v1=abcdef'],
    ['non-hex signature', `t=${NOW_SECONDS},v1=zzzz`],
    ['non-numeric timestamp', 't=not-a-number,v1=abcdef'],
  ])('rejects a malformed header (%s)', (_label, header) => {
    const result = verify(header);
    expect(result.ok).toBe(false);
    expect(result).not.toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('ignores unknown scheme versions alongside v1', () => {
    const header = `${buildSignatureHeader(BODY, SECRET, NOW_SECONDS)},v2=deadbeef`;
    expect(verify(header)).toEqual({ ok: true });
  });

  it('rejects a truncated signature instead of matching on a prefix', () => {
    const header = buildSignatureHeader(BODY, SECRET, NOW_SECONDS).slice(0, -10);
    expect(verify(header)).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('verifies bodies containing non-ASCII characters byte for byte', () => {
    const thai = Buffer.from(JSON.stringify({ note: 'ชำระเงินสำเร็จ 🎉' }), 'utf8');
    const header = buildSignatureHeader(thai, SECRET, NOW_SECONDS);
    expect(verify(header, thai)).toEqual({ ok: true });
  });
});
