import { SmtpEmailService, renderOrderConfirmation } from '../src/services/emailService';
import { makeOrder } from './helpers';

describe('renderOrderConfirmation', () => {
  it('renders totals in major units and lists items', () => {
    const { subject, text, html } = renderOrderConfirmation(makeOrder({ status: 'paid' }));

    expect(subject).toContain('ord_1');
    expect(text).toContain('250.00 THB');
    expect(text).toContain('Blue Mug x2');
    expect(html).toContain('<strong>Total: 250.00 THB</strong>');
  });

  it('escapes HTML in customer supplied values', () => {
    const order = makeOrder({
      customer: { id: 'c', email: 'a@b.c', name: '<script>alert(1)</script>' },
    });

    const { html } = renderOrderConfirmation(order);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('SmtpEmailService', () => {
  it('sends to the order customer with an idempotency reference header', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'x' });
    const service = new SmtpEmailService(
      { host: 'h', port: 587, secure: false, user: 'u', password: 'p', from: 'Store <no-reply@example.com>' },
      { sendMail } as never,
    );

    await service.sendOrderConfirmation(makeOrder({ status: 'paid' }));

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@example.com',
        from: 'Store <no-reply@example.com>',
        headers: { 'X-Entity-Ref-ID': 'order-confirmation-ord_1' },
      }),
    );
  });
});
