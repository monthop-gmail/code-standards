'use strict';

const express = require('express');

const { loadConfig } = require('./config/env');
const { createPool } = require('./db/pool');
const { logger } = require('./logger');
const { createErrorHandler } = require('./http/middleware');
const { createOrderMailer } = require('./notifications/order-mailer');
const orderRepository = require('./orders/order.repository');
const { createOrderService } = require('./orders/order.service');
const { createOrderRouter } = require('./orders/order.routes');

/**
 * ประกอบแอปทั้งหมดที่จุดเดียว — ทุก dependency ถูกสร้างที่นี่แล้วส่งลงไป
 * (ไม่มี module ไหนสร้าง pool หรืออ่าน env เองระหว่างทาง)
 *
 * `authenticate` เป็น middleware ของระบบ auth ที่มีอยู่แล้ว หน้าที่มันคือเซ็ต `req.user = { id }`
 * ตั้งใจให้ต้องส่งเข้ามา ไม่มี default — route ที่สร้าง order ห้าม "เปิดไว้ก่อนแล้วค่อยไล่ปิด"
 *
 * ผู้เรียกเป็นเจ้าของ pool ที่คืนกลับไป — ต้อง `await pool.end()` ตอน shutdown
 *
 * @param {{ authenticate: import('express').RequestHandler, pool?: import('mysql2/promise').Pool }} deps
 * @returns {{ app: import('express').Express, pool: import('mysql2/promise').Pool }}
 */
function createApp({ authenticate, pool: injectedPool }) {
  if (typeof authenticate !== 'function') {
    throw new TypeError('createApp requires an `authenticate` middleware that populates req.user');
  }

  const config = loadConfig();
  const pool = injectedPool ?? createPool(config.db);
  const mailer = createOrderMailer(config.mail);
  const service = createOrderService({ pool, repository: orderRepository, mailer, logger });

  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.use('/api/v1', authenticate, createOrderRouter({ service }));
  app.use(createErrorHandler(logger));

  return { app, pool };
}

module.exports = { createApp };
