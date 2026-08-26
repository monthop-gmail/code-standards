import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-payment-signature';

const SIGNATURE_SCHEME_VERSION = 'v1';
const HEX_PATTERN = /^[0-9a-f]+$/i;

export type SignatureFailureReason =
  | 'missing_header'
  | 'malformed_header'
  | 'timestamp_out_of_tolerance'
  | 'signature_mismatch';

export type SignatureVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: SignatureFailureReason };

interface SignatureHeaderParts {
  readonly timestampSeconds: number;
  readonly signatureHex: string;
}

/**
 * Header format (Stripe-style, also used by Omise/GBPrimePay-class gateways):
 *   x-payment-signature: t=1717070000,v1=9f86d0818...
 * Unknown keys are ignored so the gateway can roll out new scheme versions
 * alongside v1 without breaking us.
 */
function parseSignatureHeader(header: string): SignatureHeaderParts | null {
  let timestampSeconds: number | null = null;
  let signatureHex: string | null = null;

  for (const segment of header.split(',')) {
    const separatorIndex = segment.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = segment.slice(0, separatorIndex).trim();
    const value = segment.slice(separatorIndex + 1).trim();

    if (key === 't' && /^\d{1,15}$/.test(value)) {
      timestampSeconds = Number.parseInt(value, 10);
    } else if (key === SIGNATURE_SCHEME_VERSION && HEX_PATTERN.test(value)) {
      signatureHex = value.toLowerCase();
    }
  }

  if (timestampSeconds === null || signatureHex === null) {
    return null;
  }
  return { timestampSeconds, signatureHex };
}

function equalsInConstantTime(expectedHex: string, providedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(providedHex, 'hex');
  // timingSafeEqual throws on length mismatch; the length itself is not a secret.
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}

export interface SignatureVerificationInput {
  /** The exact bytes received. Re-serialising parsed JSON changes the digest and breaks verification. */
  readonly rawBody: Buffer;
  readonly header: string | undefined;
  readonly secret: string;
  readonly toleranceSeconds: number;
  readonly now: Date;
}

/**
 * Verifies HMAC-SHA256 over `<timestamp>.<raw body>`.
 *
 * The timestamp is part of the signed payload and is checked against a
 * tolerance window, which is what makes a captured delivery useless to replay
 * later. Deliveries slightly in the future are tolerated by the same window
 * because gateway clocks drift.
 *
 * Returns a result instead of throwing: an invalid signature is an expected
 * event at an internet-facing endpoint, not an exceptional one.
 */
export function verifyWebhookSignature(input: SignatureVerificationInput): SignatureVerification {
  if (!input.header) {
    return { ok: false, reason: 'missing_header' };
  }

  const parts = parseSignatureHeader(input.header);
  if (!parts) {
    return { ok: false, reason: 'malformed_header' };
  }

  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  if (Math.abs(nowSeconds - parts.timestampSeconds) > input.toleranceSeconds) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  const expectedHex = createHmac('sha256', input.secret)
    .update(`${parts.timestampSeconds}.`)
    .update(input.rawBody)
    .digest('hex');

  return equalsInConstantTime(expectedHex, parts.signatureHex)
    ? { ok: true }
    : { ok: false, reason: 'signature_mismatch' };
}

/** Builds the header a gateway would send. Used by the tests and by local replay tooling. */
export function buildSignatureHeader(rawBody: Buffer, secret: string, timestampSeconds: number): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestampSeconds}.`)
    .update(rawBody)
    .digest('hex');
  return `t=${timestampSeconds},${SIGNATURE_SCHEME_VERSION}=${digest}`;
}
