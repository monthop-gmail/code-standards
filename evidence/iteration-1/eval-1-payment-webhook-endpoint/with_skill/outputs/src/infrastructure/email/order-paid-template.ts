import { formatMoney } from '../../domain/money.js';
import type { OrderPaidEmail } from '../../application/ports.js';

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface TemplateBranding {
  readonly merchantName: string;
  readonly supportEmail: string;
}

/**
 * Every interpolated value is escaped even though order ids come from our own
 * database — the id originates from a request payload, and an HTML email client
 * is as good a place to land an injection as a browser.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderOrderPaidEmail(message: OrderPaidEmail, branding: TemplateBranding): RenderedEmail {
  const amount = formatMoney({
    amountMinorUnits: message.amountMinorUnits,
    currency: message.currency,
  });
  // Stored timestamps are UTC; ISO output keeps the email unambiguous instead of
  // rendering the server's local timezone.
  const paidAt = message.paidAt.toISOString();

  const subject = `Payment received for order ${message.orderId}`;
  const text = [
    `Thank you — we have received your payment.`,
    ``,
    `Order:   ${message.orderId}`,
    `Amount:  ${amount}`,
    `Paid at: ${paidAt}`,
    ``,
    `Questions? Reply to this email or contact ${branding.supportEmail}.`,
    ``,
    branding.merchantName,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #1a1a1a;">
    <h1 style="font-size: 20px;">Thank you — we have received your payment.</h1>
    <table cellpadding="6" style="border-collapse: collapse;">
      <tr><td><strong>Order</strong></td><td>${escapeHtml(message.orderId)}</td></tr>
      <tr><td><strong>Amount</strong></td><td>${escapeHtml(amount)}</td></tr>
      <tr><td><strong>Paid at</strong></td><td>${escapeHtml(paidAt)}</td></tr>
    </table>
    <p>Questions? Reply to this email or contact
      <a href="mailto:${encodeURIComponent(branding.supportEmail)}">${escapeHtml(branding.supportEmail)}</a>.</p>
    <p>${escapeHtml(branding.merchantName)}</p>
  </body>
</html>`;

  return { subject, text, html };
}
