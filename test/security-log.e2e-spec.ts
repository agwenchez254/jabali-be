import { NestExpressApplication } from '@nestjs/platform-express';
import { SecurityLogService } from '../src/common/security-log/security-log.service';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './global-setup';
import { bootApp, json } from './helpers/app';

jest.setTimeout(60_000);

const PASSWORD = 'Sunrise-over-Nairobi-42';

describe('security event logging', () => {
  let app: NestExpressApplication;
  let base: string;
  let events: { event: string; fields: Record<string, unknown> }[];

  beforeAll(async () => {
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'true' }));
    const log = app.get(SecurityLogService);
    events = [];
    jest.spyOn(log, 'log').mockImplementation((event, fields = {}) => {
      events.push({ event, fields });
    });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    events.length = 0;
  });

  const register = (email: string, phone: string) =>
    fetch(`${base}/store/auth/register`, json({ name: 'Log Tester', email, phone, password: PASSWORD }));
  const login = (email: string, password: string) => fetch(`${base}/store/auth/login`, json({ email, password }));
  const names = () => events.map((e) => e.event);

  it('logs registration and a successful login', async () => {
    const r = await register('log.ok@example.com', '0711000001');
    expect(r.status).toBe(201);
    expect(names()).toContain('register');
    events.length = 0;
    expect((await login('log.ok@example.com', PASSWORD)).status).toBe(200);
    expect(names()).toEqual(['login_success']);
  });

  it('logs failures, the lock-out and an unknown email', async () => {
    await register('log.fail@example.com', '0711000002');
    events.length = 0;
    expect((await login('nobody.at.all@example.com', PASSWORD)).status).toBe(401);
    expect(events[0]).toMatchObject({ event: 'login_failed', fields: { reason: 'unknown_email' } });
    events.length = 0;
    for (let i = 0; i < 5; i++) await login('log.fail@example.com', `wrong-password-${i}-xx`);
    expect(names().filter((n) => n === 'login_failed')).toHaveLength(5);
    expect(names()).toContain('account_locked');
  });

  it('logs a refresh-token reuse', async () => {
    const r = await register('log.reuse@example.com', '0711000003');
    const { refreshToken } = (await r.json()) as { refreshToken: string };
    const refresh = () => fetch(`${base}/store/auth/refresh`, json({ refreshToken }));
    expect((await refresh()).status).toBe(200);
    events.length = 0;
    expect((await refresh()).status).toBe(401);
    expect(names()).toContain('refresh_reuse');
  });

  it('logs a customer token presented to a staff route and a staff token presented to a customer route', async () => {
    const r = await register('log.type@example.com', '0711000004');
    const { accessToken } = (await r.json()) as { accessToken: string };
    events.length = 0;
    await fetch(`${base}/admin/me`, { headers: { authorization: `Bearer ${accessToken}` } });
    expect(events[0]).toMatchObject({ event: 'token_type_rejected', fields: { expected: 'staff' } });
    const staff = (await (await fetch(`${base}/admin/auth/login`, json({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }))).json()) as { accessToken: string };
    events.length = 0;
    await fetch(`${base}/store/me`, { headers: { authorization: `Bearer ${staff.accessToken}` } });
    expect(events[0]).toMatchObject({ event: 'token_type_rejected', fields: { expected: 'customer' } });
  });

  it('logs rate limiting', async () => {
    for (let i = 0; i < 6; i++) await login('rate.limited@example.com', 'wrong-password-123');
    expect(names()).toContain('rate_limited');
  });

  it('never passes a password or token to the logger', async () => {
    await register('log.secret@example.com', '0711000005');
    await login('log.secret@example.com', 'definitely-wrong-password');
    const blob = JSON.stringify(events);
    expect(blob).not.toContain(PASSWORD);
    expect(blob).not.toContain('definitely-wrong-password');
    expect(blob).not.toMatch(/accessToken|refreshToken|"password"/);
  });
});
