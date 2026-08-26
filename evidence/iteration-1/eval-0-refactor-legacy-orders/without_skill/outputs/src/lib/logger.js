'use strict';

/**
 * Minimal structured logger (JSON lines).
 *
 * Deliberately never logs whole request bodies: the legacy code did
 * `console.log('order created', orderId, req.body)`, which wrote customer
 * emails and full carts into stdout. Callers must pass an explicit,
 * curated set of fields instead.
 */
const LEVELS = { error: 50, warn: 40, info: 30, debug: 20 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function emit(level, message, fields = {}) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

module.exports = {
  error: (message, fields) => emit('error', message, fields),
  warn: (message, fields) => emit('warn', message, fields),
  info: (message, fields) => emit('info', message, fields),
  debug: (message, fields) => emit('debug', message, fields),
};
