import { computeSignature, parseSignatureHeader, verifySignature } from '../src/services/signature';
import { FIXED_NOW_MS, TEST_SECRET, signBody } from './helpers';

const body = Buffer.from('{"hello":"world"}', 'utf8');
const now = () => FIXED_NOW_MS;
const options = { secret: TEST_SECRET, toleranceSeconds: 300, now };

describe('parseSignatureHeader', () => {
  it('parses a well formed header', () => {
    expect(parseSignatureHeader('t=1700000000,v1=abc')).toEqual({ timestamp: 1700000000, signature: 'abc' });
  });

  it.each([undefined, '', 'garbage', 't=abc,v1=deadbeef', 'v1=deadbeef', 't=1700000000'])(
    'returns null for malformed header %p',
    (header) => {
      expect(parseSignatureHeader(header as string | undefined)).toBeNull();
    },
  );
});

describe('verifySignature', () => {
  it('accepts a valid signature', () => {
    expect(verifySignature(body, signBody(body.toString('utf8')), options)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const header = signBody(body.toString('utf8'));
    expect(verifySignature(Buffer.from('{"hello":"evil"}'), header, options)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const header = signBody(body.toString('utf8'), 'another-secret-value-long');
    expect(verifySignature(body, header, options)).toBe(false);
  });

  it('rejects a stale timestamp (replay)', () => {
    const staleMs = FIXED_NOW_MS - 3600 * 1000;
    const header = signBody(body.toString('utf8'), TEST_SECRET, staleMs);
    expect(verifySignature(body, header, options)).toBe(false);
  });

  it('rejects a timestamp too far in the future', () => {
    const futureMs = FIXED_NOW_MS + 3600 * 1000;
    const header = signBody(body.toString('utf8'), TEST_SECRET, futureMs);
    expect(verifySignature(body, header, options)).toBe(false);
  });

  it('rejects a non-hex signature of the same length', () => {
    const timestamp = Math.floor(FIXED_NOW_MS / 1000);
    const valid = computeSignature(TEST_SECRET, timestamp, body);
    const notHex = 'z'.repeat(valid.length);
    expect(verifySignature(body, `t=${timestamp},v1=${notHex}`, options)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifySignature(body, undefined, options)).toBe(false);
  });
});
