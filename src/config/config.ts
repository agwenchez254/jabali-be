import { z } from 'zod';

const csv = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Empty strings in .env count as unset. */
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === '' ? undefined : v), s.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174').transform(csv),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  UPLOAD_DIR: z.string().default('./uploads'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(5),
  // M-Pesa Daraja (all optional: when unset the mock provider is used)
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: opt(z.string()),
  MPESA_CONSUMER_SECRET: opt(z.string()),
  MPESA_SHORTCODE: opt(z.string()),
  MPESA_PASSKEY: opt(z.string()),
  MPESA_CALLBACK_URL: opt(z.string().url()),
  MPESA_CALLBACK_SECRET: opt(z.string().min(16)),
  ENABLE_SCHEDULER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  jwtAccessSecret: string;
  jwtAccessTtlSeconds: number;
  refreshTtlDays: number;
  uploadDir: string;
  publicBaseUrl: string;
  maxUploadBytes: number;
  enableScheduler: boolean;
  mpesa: {
    env: 'sandbox' | 'production';
    consumerKey?: string;
    consumerSecret?: string;
    shortcode?: string;
    passkey?: string;
    /** Public URL Safaricom calls, e.g. https://api.example.com/api/v1/webhooks/mpesa/<secret> */
    callbackUrl?: string;
    /** Path secret that authenticates callbacks (Daraja callbacks are unsigned). */
    callbackSecret?: string;
  };
};

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    corsOrigins: e.CORS_ORIGINS,
    jwtAccessSecret: e.JWT_ACCESS_SECRET,
    jwtAccessTtlSeconds: e.JWT_ACCESS_TTL_SECONDS,
    refreshTtlDays: e.REFRESH_TTL_DAYS,
    uploadDir: e.UPLOAD_DIR,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/$/, ''),
    maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
    enableScheduler: e.ENABLE_SCHEDULER,
    mpesa: {
      env: e.MPESA_ENV,
      consumerKey: e.MPESA_CONSUMER_KEY || undefined,
      consumerSecret: e.MPESA_CONSUMER_SECRET || undefined,
      shortcode: e.MPESA_SHORTCODE || undefined,
      passkey: e.MPESA_PASSKEY || undefined,
      callbackUrl: e.MPESA_CALLBACK_URL || undefined,
      callbackSecret: e.MPESA_CALLBACK_SECRET || undefined,
    },
  };
}
