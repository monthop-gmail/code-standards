import nodemailer, { type Transporter } from 'nodemailer';
import type { Order } from '../types/order';

export interface EmailService {
  sendOrderConfirmation(order: Order): Promise<void>;
}

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
  readonly from: string;
}

function formatAmount(minorUnits: number, currency: string): string {
  return `${(minorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderOrderConfirmation(order: Order): { subject: string; text: string; html: string } {
  const subject = `Payment received for order ${order.id}`;
  const lines = order.items.map(
    (item) => `- ${item.name} x${item.quantity} — ${formatAmount(item.unitAmount * item.quantity, order.currency)}`,
  );

  const text = [
    `Hi ${order.customer.name},`,
    '',
    `We have received your payment for order ${order.id}.`,
    '',
    ...lines,
    '',
    `Total: ${formatAmount(order.totalAmount, order.currency)}`,
    '',
    'Thank you for your purchase.',
  ].join('\n');

  const htmlItems = order.items
    .map(
      (item) =>
        `<li>${escapeHtml(item.name)} &times;${item.quantity} — ${escapeHtml(
          formatAmount(item.unitAmount * item.quantity, order.currency),
        )}</li>`,
    )
    .join('');

  const html = [
    `<p>Hi ${escapeHtml(order.customer.name)},</p>`,
    `<p>We have received your payment for order <strong>${escapeHtml(order.id)}</strong>.</p>`,
    `<ul>${htmlItems}</ul>`,
    `<p><strong>Total: ${escapeHtml(formatAmount(order.totalAmount, order.currency))}</strong></p>`,
    '<p>Thank you for your purchase.</p>',
  ].join('');

  return { subject, text, html };
}

export class SmtpEmailService implements EmailService {
  private readonly transporter: Transporter;

  constructor(
    private readonly config: SmtpConfig,
    transporter?: Transporter,
  ) {
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
      });
  }

  async sendOrderConfirmation(order: Order): Promise<void> {
    const { subject, text, html } = renderOrderConfirmation(order);
    await this.transporter.sendMail({
      from: this.config.from,
      to: order.customer.email,
      subject,
      text,
      html,
      headers: {
        // Lets the SMTP provider collapse duplicate sends of the same order.
        'X-Entity-Ref-ID': `order-confirmation-${order.id}`,
      },
    });
  }
}
