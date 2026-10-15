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
  MPESA_TRANSACTION_TYPE: z.enum(['CustomerPayBillOnline', 'CustomerBuyGoodsOnline']).default('CustomerPayBillOnline'),
  MPESA_CALLBACK_URL: opt(z.string().url()),
  MPESA_CALLBACK_SECRET: opt(z.string().min(16)),
  ENABLE_SCHEDULER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Email (SMTP). Empty SMTP_URL = log-only transport in development and test.
  SMTP_URL: opt(z.string().regex(/^smtps?:\/\/\S+$/, 'SMTP_URL must start with smtp:// or smtps://')),
  RESEND_API_KEY: z.string(),
  MAIL_FROM: z
    .string()
    .min(3)
    .refine((v) => v.includes('@') && !/[\r\n]/.test(v), 'MAIL_FROM must be an address without line breaks')
    .default('Jabali <no-reply@jabali.co.ke>'),
  MAIL_REPLY_TO: opt(z.string().refine((v) => v.includes('@') && !/[\r\n]/.test(v), 'MAIL_REPLY_TO must be an address without line breaks')),
  STORE_URL: z.string().url().default('http://localhost:5173'),
  // Number of reverse proxies in front of the API (so req.ip is the real client address).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  RATE_LIMIT_ENABLED: z
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
  trustProxyHops: number;
  rateLimitEnabled: boolean;
  mail: { smtpUrl?: string; from: string; replyTo?: string; storeUrl: string, apiKey: string };
  mpesa: {
    env: 'sandbox' | 'production';
    consumerKey?: string;
    consumerSecret?: string;
    shortcode?: string;
    passkey?: string;
    /** Public URL Safaricom calls, e.g. https://api.example.com/api/v1/webhooks/mpesa/<secret> */
    transactionType: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline';
    callbackUrl?: string;
    /** Path secret that authenticates callbacks (Daraja callbacks are unsigned). */
    callbackSecret?: string;
  };
};

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Wildcards are never allowed (credentials are enabled); production origins must be https. */
export function assertCorsOrigins(origins: string[], nodeEnv: AppConfig['nodeEnv']): void {
  for (const o of origins) {
    if (o.includes('*')) throw new Error('CORS_ORIGINS must not contain a wildcard');
    if (nodeEnv === 'production' && !o.startsWith('https://')) throw new Error(`CORS_ORIGINS must use https in production (got ${o})`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  const e = parsed.data;
  assertCorsOrigins(e.CORS_ORIGINS, e.NODE_ENV);
  if (e.NODE_ENV === 'production' && !e.RATE_LIMIT_ENABLED) throw new Error('RATE_LIMIT_ENABLED=false is not allowed in production');
  if (e.NODE_ENV === 'production') {
    if (!e.SMTP_URL) throw new Error('SMTP_URL is required in production so customer email is never silently dropped');
    if (!e.STORE_URL.startsWith('https://')) throw new Error('STORE_URL must use https in production');
  }
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
    trustProxyHops: e.TRUST_PROXY_HOPS,
    rateLimitEnabled: e.RATE_LIMIT_ENABLED,
    mail: { smtpUrl: e.SMTP_URL || undefined, from: e.MAIL_FROM, replyTo: e.MAIL_REPLY_TO || undefined, storeUrl: e.STORE_URL.replace(/\/+$/, ''), apiKey: e.RESEND_API_KEY },
    mpesa: {
      env: e.MPESA_ENV,
      consumerKey: e.MPESA_CONSUMER_KEY || undefined,
      consumerSecret: e.MPESA_CONSUMER_SECRET || undefined,
      shortcode: e.MPESA_SHORTCODE || undefined,
      passkey: e.MPESA_PASSKEY || undefined,
      transactionType: e.MPESA_TRANSACTION_TYPE,
      callbackUrl: e.MPESA_CALLBACK_URL || undefined,
      callbackSecret: e.MPESA_CALLBACK_SECRET || undefined,
    },
  };
}
