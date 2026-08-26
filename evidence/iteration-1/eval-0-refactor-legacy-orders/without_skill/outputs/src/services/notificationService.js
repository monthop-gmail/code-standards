'use strict';

const logger = require('../lib/logger');

/**
 * Sends the order-confirmation email.
 *
 * Differences from the legacy inline block:
 *  - the API key comes from config, not a string literal in the route file;
 *  - `require('node-fetch')` no longer happens per-request inside the handler
 *    (Node 18+ has a global fetch);
 *  - the request has a timeout, so a hanging mail host can't pin an Express
 *    worker open indefinitely;
 *  - failures are logged instead of being swallowed by `catch (e) {}`.
 */
class NotificationService {
  constructor(mailerConfig, { fetchImpl = globalThis.fetch } = {}) {
    this.config = mailerConfig;
    this.fetch = fetchImpl;
  }

  /**
   * Best-effort send. Never throws: a mail outage must not fail an order that
   * is already committed. Returns whether the send succeeded.
   *
   * @returns {Promise<boolean>}
   */
  async sendOrderConfirmation({ to, orderId }) {
    if (!to) {
      logger.warn('order.confirmation.skipped', { orderId, reason: 'no recipient' });
      return false;
    }

    try {
      const response = await this.fetch(this.config.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.config.apiKey,
        },
        body: JSON.stringify({ to, tpl: 'order_confirm', orderId }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        logger.warn('order.confirmation.failed', { orderId, status: response.status });
        return false;
      }
      return true;
    } catch (error) {
      // Log the reason, but never the recipient address or the API key.
      logger.warn('order.confirmation.error', { orderId, reason: error.message });
      return false;
    }
  }
}

module.exports = { NotificationService };
