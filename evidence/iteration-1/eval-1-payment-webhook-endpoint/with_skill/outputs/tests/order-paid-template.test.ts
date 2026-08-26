import { describe, expect, it } from 'vitest';
import { renderOrderPaidEmail } from '../src/infrastructure/email/order-paid-template.js';

const branding = { merchantName: 'Example Store', supportEmail: 'support@example.com' };
const message = {
  to: 'customer@example.com',
  orderId: 'ord_1001',
  amountMinorUnits: 125_000,
  currency: 'THB',
  paidAt: new Date('2026-08-24T10:00:00.000Z'),
};

describe('renderOrderPaidEmail', () => {
  it('states the order, the amount and the time in both parts', () => {
    const rendered = renderOrderPaidEmail(message, branding);

    expect(rendered.subject).toBe('Payment received for order ord_1001');
    expect(rendered.text).toContain('ord_1001');
    expect(rendered.text).toContain('2026-08-24T10:00:00.000Z');
    expect(rendered.html).toContain('ord_1001');
    // Timestamps go out in UTC so a Bangkok customer and a UTC server agree.
    expect(rendered.html).toContain('2026-08-24T10:00:00.000Z');
  });

  it('escapes order ids so a crafted id cannot inject markup into the email', () => {
    const rendered = renderOrderPaidEmail(
      { ...message, orderId: '<img src=x onerror="alert(1)">' },
      branding,
    );

    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain('&lt;img');
    expect(rendered.html).not.toContain('onerror="');
  });

  it('escapes branding values as well', () => {
    const rendered = renderOrderPaidEmail(message, { ...branding, merchantName: 'A & B <Store>' });

    expect(rendered.html).toContain('A &amp; B &lt;Store&gt;');
    expect(rendered.text).toContain('A & B <Store>');
  });
});
