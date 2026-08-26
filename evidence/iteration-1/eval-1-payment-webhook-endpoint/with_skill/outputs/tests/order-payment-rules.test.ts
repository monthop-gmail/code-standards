import { describe, expect, it } from 'vitest';
import { decidePayment } from '../src/domain/order.js';
import { formatMoney, isSameMoney, normalizeCurrency } from '../src/domain/money.js';
import { pendingOrder } from './support/test-doubles.js';

const attempt = { paymentId: 'pay_1', amountMinorUnits: 125_000, currency: 'THB' };

describe('decidePayment', () => {
  it('accepts a payment that matches the stored order exactly', () => {
    expect(decidePayment(pendingOrder(), attempt)).toEqual({ kind: 'accept' });
  });

  it('accepts regardless of the currency casing the gateway uses', () => {
    expect(decidePayment(pendingOrder(), { ...attempt, currency: 'thb' })).toEqual({ kind: 'accept' });
  });

  it('rejects an underpayment', () => {
    expect(decidePayment(pendingOrder(), { ...attempt, amountMinorUnits: 100 })).toEqual({
      kind: 'reject',
      reason: 'amount_mismatch',
    });
  });

  it('rejects an overpayment as well, since it is equally unexplained', () => {
    expect(decidePayment(pendingOrder(), { ...attempt, amountMinorUnits: 999_999 })).toEqual({
      kind: 'reject',
      reason: 'amount_mismatch',
    });
  });

  it('rejects a zero-amount notification for a non-zero order', () => {
    expect(decidePayment(pendingOrder(), { ...attempt, amountMinorUnits: 0 })).toEqual({
      kind: 'reject',
      reason: 'amount_mismatch',
    });
  });

  it('rejects the right amount in the wrong currency', () => {
    expect(decidePayment(pendingOrder(), { ...attempt, currency: 'USD' })).toEqual({
      kind: 'reject',
      reason: 'currency_mismatch',
    });
  });

  it('treats the same payment on an already paid order as a redelivery', () => {
    const order = pendingOrder({ status: 'paid', paymentId: 'pay_1' });
    expect(decidePayment(order, attempt)).toEqual({ kind: 'already_applied' });
  });

  it('flags a second, different payment on a paid order', () => {
    const order = pendingOrder({ status: 'paid', paymentId: 'pay_other' });
    expect(decidePayment(order, attempt)).toEqual({ kind: 'reject', reason: 'conflicting_payment' });
  });

  it.each(['cancelled', 'expired'] as const)('refuses to pay a %s order', (status) => {
    expect(decidePayment(pendingOrder({ status }), attempt)).toEqual({
      kind: 'reject',
      reason: 'order_not_payable',
    });
  });
});

// Intl separates the currency code from the amount with a non-breaking space;
// normalising it keeps these assertions readable.
const plain = (value: string): string => value.replace(/\u00a0/g, ' ');

describe('money', () => {
  it('formats two-decimal currencies from minor units', () => {
    expect(formatMoney({ amountMinorUnits: 125_000, currency: 'THB' })).toContain('1,250.00');
  });

  it('formats zero-decimal currencies without inventing decimals', () => {
    expect(formatMoney({ amountMinorUnits: 1_250, currency: 'JPY' })).toContain('1,250');
    expect(formatMoney({ amountMinorUnits: 1_250, currency: 'JPY' })).not.toContain('12.50');
  });

  it('formats an unknown but well-formed code with the two-decimal default', () => {
    expect(plain(formatMoney({ amountMinorUnits: 500, currency: 'XYZ' }))).toBe('XYZ 5.00');
  });

  it('degrades to a plain rendering instead of throwing on a malformed code', () => {
    expect(plain(formatMoney({ amountMinorUnits: 500, currency: 'TH1' }))).toBe('500 TH1');
  });

  it('formats zero', () => {
    expect(formatMoney({ amountMinorUnits: 0, currency: 'THB' })).toContain('0.00');
  });

  it('compares amounts irrespective of currency casing and whitespace', () => {
    expect(isSameMoney({ amountMinorUnits: 1, currency: ' thb ' }, { amountMinorUnits: 1, currency: 'THB' })).toBe(
      true,
    );
    expect(normalizeCurrency(' usd ')).toBe('USD');
  });
});
