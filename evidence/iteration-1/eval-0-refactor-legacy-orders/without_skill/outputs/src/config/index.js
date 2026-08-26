'use strict';

/**
 * Central configuration. Every secret comes from the environment — the
 * legacy file hard-coded the production DB password and a live mail API
 * key directly in source, which means they were leaked to anyone with repo
 * access and to every clone, fork and CI log.
 *
 * The process fails fast at boot if a required variable is missing, rather
 * than blowing up on the first customer request.
 */

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

function load() {
  return Object.freeze({
    db: Object.freeze({
      host: required('DB_HOST'),
      port: optionalInt('DB_PORT', 3306),
      user: required('DB_USER'),
      password: required('DB_PASSWORD'),
      database: required('DB_NAME'),
      connectionLimit: optionalInt('DB_POOL_SIZE', 10),
    }),
    mailer: Object.freeze({
      baseUrl: process.env.MAILER_URL ?? 'https://mail.acme.co/send',
      apiKey: required('MAILER_API_KEY'),
      timeoutMs: optionalInt('MAILER_TIMEOUT_MS', 3000),
    }),
    limits: Object.freeze({
      maxItemsPerOrder: optionalInt('MAX_ITEMS_PER_ORDER', 100),
      maxQtyPerLine: optionalInt('MAX_QTY_PER_LINE', 999),
    }),
  });
}

module.exports = { load, required, optionalInt };
