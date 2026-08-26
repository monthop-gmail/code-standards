import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../../config.js';
import { EmailDeliveryError } from '../../errors.js';
import type { EmailSender, OrderPaidEmail } from '../../application/ports.js';
import { renderOrderPaidEmail } from './order-paid-template.js';

export class NodemailerEmailSender implements EmailSender {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly branding: { merchantName: string; supportEmail: string };

  constructor(
    config: Pick<AppConfig, 'SMTP_URL' | 'MAIL_FROM' | 'MERCHANT_NAME' | 'MERCHANT_SUPPORT_EMAIL'>,
    transporter?: Transporter,
  ) {
    this.transporter =
      transporter ??
      nodemailer.createTransport(config.SMTP_URL, {
        // Without these a hung SMTP server would hold the request open until the
        // gateway times out and redelivers.
        connectionTimeout: 5_000,
        greetingTimeout: 5_000,
        socketTimeout: 10_000,
        pool: true,
        maxConnections: 3,
      });
    this.from = config.MAIL_FROM;
    this.branding = {
      merchantName: config.MERCHANT_NAME,
      supportEmail: config.MERCHANT_SUPPORT_EMAIL,
    };
  }

  async sendOrderPaidConfirmation(message: OrderPaidEmail): Promise<void> {
    const rendered = renderOrderPaidEmail(message, this.branding);
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
    } catch (cause) {
      // The recipient address is left out of the error context on purpose: it is
      // customer PII and this message ends up in logs.
      throw new EmailDeliveryError('failed to send order confirmation email', {
        cause,
        context: { orderId: message.orderId },
      });
    }
  }

  async close(): Promise<void> {
    this.transporter.close();
  }
}
