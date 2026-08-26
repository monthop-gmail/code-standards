import { config } from './config.js';
import { pool } from './db.js';
import { closeMailer, verifyMailerConnection } from './email/mailer.js';
import { createApp } from './http/app.js';
import { describeError, logger } from './logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = createApp().listen(config.PORT, () => {
  logger.info('server_started', { port: config.PORT, env: config.NODE_ENV });
});

// เช็ค SMTP ตอน boot เพื่อให้รู้ว่า config ผิดตั้งแต่ deploy ไม่ใช่ตอนมีออร์เดอร์แรก
// ไม่ทำให้ service ตาย เพราะการรับ webhook ยังสำคัญกว่าอีเมล
void verifyMailerConnection().catch((error: unknown) => {
  logger.warn('smtp_verification_failed', { error: describeError(error) });
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown_started', { signal });

  const forceExit = setTimeout(() => {
    logger.error('shutdown_timed_out', { timeoutMs: SHUTDOWN_TIMEOUT_MS });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    // หยุดรับ request ใหม่ก่อน แล้วค่อยปิด resource ที่ request ที่ค้างอยู่ยังใช้
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    closeMailer();
    await pool.end();
    logger.info('shutdown_complete', { signal });
    process.exit(0);
  } catch (error) {
    logger.error('shutdown_failed', { signal, error: describeError(error) });
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('unhandled_rejection', { error: describeError(reason) });
});

process.on('uncaughtException', (error: Error) => {
  // state ของ process ไม่น่าเชื่อถือแล้ว — log แล้วออกให้ orchestrator รีสตาร์ต
  logger.error('uncaught_exception', { error: describeError(error), stack: error.stack });
  process.exit(1);
});
