import { z } from 'zod';

/**
 * Every secret and endpoint comes from the environment so that nothing
 * deployment-specific is baked into the image. Parsing happens once at
 * startup and throws: a mis-configured process should refuse to boot rather
 * than fail on the first webhook at 3 a.m.
 */
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),

  // 32 chars is the shortest secret worth calling a secret for HMAC-SHA256.
  PAYMENT_WEBHOOK_SECRET: z.string().min(32),
  PAYMENT_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

  SMTP_URL: z.string().min(1),
  // Allows both "a@b.com" and "Store <a@b.com>", so it is not validated as a bare email.
  MAIL_FROM: z.string().min(3),
  MERCHANT_NAME: z.string().min(1).default('Our Store'),
  MERCHANT_SUPPORT_EMAIL: z.string().email(),
});

export type AppConfig = Readonly<z.infer<typeof environmentSchema>>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    // Only the variable names are reported — never the values, which are secrets.
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return Object.freeze(parsed.data);
}
