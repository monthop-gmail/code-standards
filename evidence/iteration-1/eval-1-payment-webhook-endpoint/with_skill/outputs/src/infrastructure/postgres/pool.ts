import pg from 'pg';
import type { AppConfig } from '../../config.js';

/**
 * A single pool for the process. Timeouts are set explicitly because the
 * defaults are "wait forever", which turns a slow database into hung webhook
 * requests and, eventually, an exhausted gateway retry budget.
 */
export function createPool(config: Pick<AppConfig, 'DATABASE_URL' | 'NODE_ENV'>): pg.Pool {
  return new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Keeps a stuck query from pinning a connection for the whole request.
    statement_timeout: 10_000,
    query_timeout: 10_000,
    ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
  });
}
