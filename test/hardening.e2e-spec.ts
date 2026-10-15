import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config/config';
import { bootApp, json } from './helpers/app';

jest.setTimeout(60_000);

describe('response hardening', () => {
  let app: NestFastifyApplication;
  let base: string;
  beforeAll(async () => {
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'false' }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('sets the security headers and hides the framework', async () => {
    const r = await fetch(`${base}/store/delivery/zones`);
    expect(r.headers.get('strict-transport-security')).toContain('max-age=31536000');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('x-powered-by')).toBeNull();
  });

  it('rejects a body over 100 kB with 413', async () => {
    const r = await fetch(`${base}/store/auth/login`, json({ email: 'a@b.co', password: 'x'.repeat(200_000) }));
    expect(r.status).toBe(413);
  });

  it('answers malformed JSON with 400, not 500', async () => {
    const r = await fetch(`${base}/store/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email": ' });
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type')).toContain('application/problem+json');
  });

  it('serves uploads with nosniff and a sandbox CSP', async () => {
    const dir = resolve(loadConfig().uploadDir);
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, 'e2e-hardening.txt');
    writeFileSync(file, 'hello');
    try {
      const r = await fetch(`${base.replace('/api/v1', '')}/uploads/e2e-hardening.txt`);
      expect(r.status).toBe(200);
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('content-security-policy')).toBe('sandbox');
    } finally {
      rmSync(file, { force: true });
    }
  });
});
