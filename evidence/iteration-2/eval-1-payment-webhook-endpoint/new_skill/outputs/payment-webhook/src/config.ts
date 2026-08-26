import { z } from 'zod';

/**
 * Config ทั้งหมดมาจาก env เท่านั้น และถูก validate ตอน boot
 * เหตุผลที่ fail fast: ถ้า PAYMENT_WEBHOOK_SECRET หาย service จะรับ webhook ที่ verify ไม่ได้
 * ตั้งแต่วินาทีแรก — พังตอน deploy ดีกว่าพังตอนมีเงินวิ่งเข้ามา
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().min(1),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16, 'ต้องยาวอย่างน้อย 16 ตัวอักษร'),
  PAYMENT_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().min(1),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // พิมพ์เฉพาะ "ชื่อ" ตัวแปรกับเหตุผล ห้ามพิมพ์ค่า — env มี secret ปนอยู่
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`ตั้งค่า environment ไม่ถูกต้อง:\n${problems}`);
  }
  return Object.freeze(parsed.data);
}

export const config: AppConfig = loadConfig();
