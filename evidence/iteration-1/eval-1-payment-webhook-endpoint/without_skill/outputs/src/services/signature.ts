import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignatureHeader {
  readonly timestamp: number;
  readonly signature: string;
}

/**
 * Parses a Stripe-style header: `t=1700000000,v1=<hex hmac>`.
 * Returns null when the header is absent or malformed.
 */
export function parseSignatureHeader(header: string | undefined): SignatureHeader | null {
  if (!header) return null;

  let timestamp: number | null = null;
  let signature: string | null = null;

  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (!key || !value) continue;
    if (key === 't') {
      const parsedTimestamp = Number(value);
      if (Number.isInteger(parsedTimestamp) && parsedTimestamp > 0) timestamp = parsedTimestamp;
    } else if (key === 'v1') {
      signature = value;
    }
  }

  if (timestamp === null || signature === null) return null;
  return { timestamp, signature };
}

export function computeSignature(secret: string, timestamp: number, rawBody: Buffer): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  // Reject non-hex/odd-length input before Buffer.from silently truncates it.
  if (a.length !== b.length || a.length === 0 || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export interface VerifyOptions {
  readonly secret: string;
  readonly toleranceSeconds: number;
  /** Injectable for deterministic tests. */
  readonly now?: () => number;
}

/**
 * Verifies HMAC-SHA256 over `${timestamp}.${rawBody}` in constant time,
 * and rejects timestamps outside the tolerance window (replay protection).
 */
export function verifySignature(
  rawBody: Buffer,
  header: string | undefined,
  options: VerifyOptions,
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;

  const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > options.toleranceSeconds) return false;

  const expected = computeSignature(options.secret, parsed.timestamp, rawBody);
  return safeEqualHex(expected, parsed.signature);
}
