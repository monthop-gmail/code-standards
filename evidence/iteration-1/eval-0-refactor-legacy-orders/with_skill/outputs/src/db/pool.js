'use strict';

const mysql = require('mysql2/promise');

/**
 * @param {import('../config/env').AppConfig['db']} dbConfig
 * @returns {import('mysql2/promise').Pool}
 */
function createPool(dbConfig) {
  return mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    connectionLimit: dbConfig.connectionLimit,
    waitForConnections: true,
    // DECIMAL มาเป็น string เสมอ — โค้ดคิดเงินแปลงเป็นจำนวนเต็มสตางค์เอง
    // ห้ามให้ driver แปลงเป็น float ให้
    decimalNumbers: false,
  });
}

module.exports = { createPool };
