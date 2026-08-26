'use strict';

const { ConfigurationError } = require('../errors');

/**
 * อ่าน config จาก environment variable เท่านั้น — ไม่มี default สำหรับ secret
 * (ของเดิม hardcode password DB และ mail API key ไว้ในไฟล์ route)
 */

/**
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new ConfigurationError(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function optionalInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigurationError(`Environment variable ${name} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

/**
 * @typedef {object} AppConfig
 * @property {{ host: string, port: number, user: string, password: string, database: string, connectionLimit: number }} db
 * @property {{ apiUrl: string, apiKey: string, timeoutMs: number }} mail
 */

/**
 * เรียกตอน boot เท่านั้น (ไม่เรียกตอน import) เพื่อให้ test import module อื่นได้
 * โดยไม่ต้องตั้ง env ครบ
 * @returns {AppConfig}
 */
function loadConfig() {
  return {
    db: {
      host: requireEnv('DB_HOST'),
      port: optionalInt('DB_PORT', 3306),
      user: requireEnv('DB_USER'),
      password: requireEnv('DB_PASSWORD'),
      database: requireEnv('DB_NAME'),
      connectionLimit: optionalInt('DB_CONNECTION_LIMIT', 10),
    },
    mail: {
      apiUrl: requireEnv('MAIL_API_URL'),
      apiKey: requireEnv('MAIL_API_KEY'),
      timeoutMs: optionalInt('MAIL_TIMEOUT_MS', 5000),
    },
  };
}

module.exports = { loadConfig, requireEnv, optionalInt };
