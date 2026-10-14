import { NestExpressApplication } from '@nestjs/platform-express';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './global-setup';
import { bootApp, json } from './helpers/app';

jest.setTimeout(60_000);

describe('POST /store/orders authentication', () => {
  let app: NestExpressApplication;
  let base: string;
  beforeAll(async () => {
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'false' }));
  });
  afterAll(async () => {
    await app.close();
  });

  const key = { 'idempotency-key': 'e2e-orders-key-0001' };

  it('rejects an anonymous order with 401', async () => {
    const r = await fetch(`${base}/store/orders`, json({ lines: [] }, key));
    expect(r.status).toBe(401);
  });

  it('rejects a staff token with 401', async () => {
    const login = await fetch(`${base}/admin/auth/login`, json({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }));
    const { accessToken } = (await login.json()) as { accessToken: string };
    const r = await fetch(`${base}/store/orders`, json({ lines: [] }, { ...key, authorization: `Bearer ${accessToken}` }));
    expect(r.status).toBe(401);
  });

  it('lets a customer token through the guard (an empty basket then fails validation with 400)', async () => {
    const reg = await fetch(
      `${base}/store/auth/register`,
      json({ name: 'Order Tester', email: 'order.tester@example.com', phone: '0700123456', password: 'Sunrise-over-Nairobi-42' }),
    );
    const { accessToken } = (await reg.json()) as { accessToken: string };
    const r = await fetch(`${base}/store/orders`, json({ lines: [] }, { ...key, authorization: `Bearer ${accessToken}` }));
    expect(r.status).toBe(400);
  });
});
