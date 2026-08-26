export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Structured logging แบบ JSON บรรทัดเดียว เพื่อให้ log aggregator (Loki/CloudWatch) query ได้
 * ผู้เรียกเป็นคนเลือกว่าจะใส่ field อะไร — ห้ามส่ง raw body, Authorization header,
 * token หรืออีเมลเต็มเข้ามา (ใช้ maskEmail ก่อน)
 */
export function createLogger(minLevel: LogLevel): Logger {
  const write = (level: LogLevel, event: string, fields?: LogFields): void => {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) return;
    const line = JSON.stringify({
      level,
      event,
      time: new Date().toISOString(),
      ...fields,
    });
    process.stdout.write(`${line}\n`);
  };

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

/** `somchai@example.com` -> `s*****i@example.com` เพื่อให้ debug ได้โดยไม่เก็บ PII เต็มลง log */
export function maskEmail(email: string): string {
  const atIndex = email.lastIndexOf('@');
  if (atIndex <= 0) return '***';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  if (local.length <= 2) return `${'*'.repeat(local.length)}${domain}`;
  return `${local[0] ?? ''}${'*'.repeat(local.length - 2)}${local[local.length - 1] ?? ''}${domain}`;
}

/** ดึงข้อความจาก error ที่ type เป็น unknown โดยไม่เผลอ log ทั้ง object (อาจมี query/credential ติดมา) */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'unknown error';
}

function resolveLogLevel(raw: string | undefined): LogLevel {
  return raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' ? raw : 'info';
}

/**
 * instance เดียวทั้ง process
 * อ่าน env ตรงนี้แทนที่จะพึ่ง config.ts เพื่อให้ไฟล์นี้ import ได้จากทุกที่ (รวมถึงเทสต์)
 * โดยไม่ลาก validation ของ config ทั้งก้อนมาด้วย
 */
export const logger: Logger = createLogger(resolveLogLevel(process.env['LOG_LEVEL']));
