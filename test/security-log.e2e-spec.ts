import { NestExpressApplication } from '@nestjs/platform-express';
import { SecurityLogService } from '../src/common/security-log/security-log.service';
import { APP_CONFIG, AppConfig } from '../src/config/config';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './global-setup';
import { bootApp, json } from './helpers/app';
import { lastCode, registerVerified } from './helpers/auth';

jest.setTimeout(60_000);

const PASSWORD = 'Sunrise-over-Nairobi-42';
const acct = (email: string, phone: string) => ({ name: 'Log Tester', email, phone, password: PASSWORD });

describe('security event logging', () => {
  let app: NestExpressApplication;
  let base: string;
  let events: { event: string; fields: Record<string, unknown> }[];

  beforeAll(async () => {
    // Sign-up is limited to 5 a minute per IP, so limits are off except inside the one test about them.
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'false' }));
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

  const login = (email: string, password: string) => fetch(`${base}/store/auth/login`, json({ email, password }));
  const names = () => events.map((e) => e.event);

  it('logs sign-up, the code being sent, activation and a successful login', async () => {
    const a = acct('log.ok@example.com', '0711000001');
    expect((await fetch(`${base}/store/auth/register`, json(a))).status).toBe(201);
    expect(names()).toEqual(expect.arrayContaining(['register', 'verification_sent']));
    events.length = 0;
    expect((await fetch(`${base}/store/auth/verify`, json({ email: a.email, code: lastCode(app, a.email) }))).status).toBe(200);
    expect(names()).toEqual(['email_verified']);
    events.length = 0;
    expect((await login(a.email, PASSWORD)).status).toBe(200);
    expect(names()).toEqual(['login_success']);
  });

  it('logs a wrong verification code', async () => {
    const a = acct('log.wrongcode@example.com', '0711000006');
    await fetch(`${base}/store/auth/register`, json(a));
    events.length = 0;
    const right = lastCode(app, a.email);
    await fetch(`${base}/store/auth/verify`, json({ email: a.email, code: right === '000000' ? '000001' : '000000' }));
    expect(events[0]).toMatchObject({ event: 'verification_failed', fields: { reason: 'wrong_code' } });
  });

  it('logs failures, the lock-out and an unknown email', async () => {
    await registerVerified(app, base, acct('log.fail@example.com', '0711000002'));
    events.length = 0;
    expect((await login('nobody.at.all@example.com', PASSWORD)).status).toBe(401);
    expect(events[0]).toMatchObject({ event: 'login_failed', fields: { reason: 'unknown_email' } });
    events.length = 0;
    for (let i = 0; i < 5; i++) await login('log.fail@example.com', `wrong-password-${i}-xx`);
    expect(names().filter((n) => n === 'login_failed')).toHaveLength(5);
    expect(names()).toContain('account_locked');
  });

  it('logs a refresh-token reuse', async () => {
    const { refreshToken } = await registerVerified(app, base, acct('log.reuse@example.com', '0711000003'));
    const refresh = () => fetch(`${base}/store/auth/refresh`, json({ refreshToken }));
    expect((await refresh()).status).toBe(200);
    events.length = 0;
    expect((await refresh()).status).toBe(401);
    expect(names()).toContain('refresh_reuse');
  });

  it('logs a customer token presented to a staff route and a staff token presented to a customer route', async () => {
    const { accessToken } = await registerVerified(app, base, acct('log.type@example.com', '0711000004'));
    events.length = 0;
    await fetch(`${base}/admin/me`, { headers: { authorization: `Bearer ${accessToken}` } });
    expect(events[0]).toMatchObject({ event: 'token_type_rejected', fields: { expected: 'staff' } });
    const staff = (await (await fetch(`${base}/admin/auth/login`, json({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }))).json()) as { accessToken: string };
    events.length = 0;
    await fetch(`${base}/store/me`, { headers: { authorization: `Bearer ${staff.accessToken}` } });
    expect(events[0]).toMatchObject({ event: 'token_type_rejected', fields: { expected: 'customer' } });
  });

  it('logs rate limiting', async () => {
    const cfg = app.get<AppConfig>(APP_CONFIG);
    cfg.rateLimitEnabled = true;
    try {
      for (let i = 0; i < 6; i++) await login('rate.limited@example.com', 'wrong-password-123');
    } finally {
      cfg.rateLimitEnabled = false;
    }
    expect(names()).toContain('rate_limited');
  });

  it('never passes a password, token or code to the logger', async () => {
    const a = acct('log.secret@example.com', '0711000005');
    await fetch(`${base}/store/auth/register`, json(a));
    const code = lastCode(app, a.email);
    await fetch(`${base}/store/auth/verify`, json({ email: a.email, code }));
    await login(a.email, 'definitely-wrong-password');
    const blob = JSON.stringify(events);
    expect(blob).not.toContain(PASSWORD);
    expect(blob).not.toContain('definitely-wrong-password');
    expect(blob).not.toContain(code);
    expect(blob).not.toMatch(/accessToken|refreshToken|"password"|"code"/);
  });
});
