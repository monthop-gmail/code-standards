'use strict';

const mysql = require('mysql2/promise');

/**
 * Creates the connection pool from injected config.
 * The legacy module built a pool at import time using hard-coded production
 * credentials, so merely requiring the route file opened a live connection.
 */
function createPool(dbConfig) {
  return mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: dbConfig.connectionLimit,
    maxIdle: dbConfig.connectionLimit,
    enableKeepAlive: true,
    namedPlaceholders: false,
    // Defence in depth: even if a bad query string slipped through, the
    // driver will not execute a second stacked statement.
    multipleStatements: false,
  });
}

module.exports = { createPool };
