import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { bootApp, json } from './helpers/app';

jest.setTimeout(120_000);

describe('rate limiting', () => {
  let app: NestFastifyApplication;
  let base: string;
  beforeAll(async () => {
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'true' }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('limits login to 5 per minute per email', async () => {
    const attempt = () => fetch(`${base}/store/auth/login`, json({ email: 'victim@example.com', password: 'wrong-password-123' }));
    for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(401);
    const sixth = await attempt();
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = (await sixth.json()) as { code?: string };
    expect(body.code).toBe('rate_limited');
  });

  it('limits login to 10 per minute per IP across different emails', async () => {
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${base}/store/auth/login`, json({ email: `user${i}@example.com`, password: 'wrong-password-123' }));
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('caps concurrent event streams at 5 per IP', async () => {
    const ctrls: AbortController[] = [];
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const c = new AbortController();
      ctrls.push(c);
      const r = await fetch(`${base}/store/events`, { signal: c.signal });
      statuses.push(r.status);
    }
    ctrls.forEach((c) => c.abort());
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });

  it('never throttles the M-Pesa callback, however many requests arrive from one address', async () => {
    let limited = 0;
    for (let i = 0; i < 130; i++) {
      const r = await fetch(`${base}/webhooks/mpesa/not-the-secret`, json({}));
      if (r.status === 429) limited++;
    }
    expect(limited).toBe(0);
  });
});
