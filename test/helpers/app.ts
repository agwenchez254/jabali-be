import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { loadConfig } from '../../src/config/config';
import { configureApp, createAdapter } from '../../src/setup';

export const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://jabali:jabali_dev_pw@localhost:5439/jabali_test?schema=public';

/** Boots the whole app on a random port against the test database. Env overrides apply before the app loads. */
export async function bootApp(env: Record<string, string> = {}): Promise<{ app: NestFastifyApplication; base: string }> {
  // Env is shared across e2e files in one process, so every default is set explicitly each time.
  Object.assign(process.env, { DATABASE_URL: TEST_URL, ENABLE_SCHEDULER: 'false', RATE_LIMIT_ENABLED: 'true', SMTP_URL: '' }, env);
  const { AppModule } = await import('../../src/app.module');
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const cfg = loadConfig();
  const app = mod.createNestApplication<NestFastifyApplication>(createAdapter(cfg), { rawBody: true });
  await configureApp(app, cfg);
  await app.listen(0);
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  return { app, base };
}

export const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
