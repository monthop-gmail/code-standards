'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { NotificationService } = require('../src/services/notificationService');

const config = { baseUrl: 'https://mail.example.test/send', apiKey: 'test-key', timeoutMs: 100 };

test('sends the confirmation with the configured API key', async () => {
  const calls = [];
  const service = new NotificationService(config, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    },
  });

  const sent = await service.sendOrderConfirmation({ to: 'a@b.co', orderId: 5 });

  assert.equal(sent, true);
  assert.equal(calls[0].url, config.baseUrl);
  assert.equal(calls[0].options.headers['X-Api-Key'], 'test-key');
  assert.deepEqual(JSON.parse(calls[0].options.body), { to: 'a@b.co', tpl: 'order_confirm', orderId: 5 });
});

test('a mail outage never throws, so a committed order still succeeds', async () => {
  const service = new NotificationService(config, {
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });

  assert.equal(await service.sendOrderConfirmation({ to: 'a@b.co', orderId: 5 }), false);
});

test('a non-2xx mail response is reported as a failed send', async () => {
  const service = new NotificationService(config, {
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });

  assert.equal(await service.sendOrderConfirmation({ to: 'a@b.co', orderId: 5 }), false);
});

test('skips sending when no recipient is known', async () => {
  let called = false;
  const service = new NotificationService(config, {
    fetchImpl: async () => { called = true; return { ok: true }; },
  });

  assert.equal(await service.sendOrderConfirmation({ to: null, orderId: 5 }), false);
  assert.equal(called, false);
});
