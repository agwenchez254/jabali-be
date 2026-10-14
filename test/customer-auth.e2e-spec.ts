import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/prisma/prisma.service';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './global-setup';
import { bootApp, json } from './helpers/app';

jest.setTimeout(60_000);

const PASSWORD = 'Sunrise-over-Nairobi-42';
let seq = 0;
const uniq = () => ++seq;
const phoneFor = (n: number) => `07${String(10000000 + n).slice(-8)}`; // 07 + 8 digits

describe('customer auth', () => {
  let app: NestExpressApplication;
  let base: string;

  beforeAll(async () => {
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'false' }));
  });
  afterAll(async () => {
    await app.close();
  });

  const register = (over: Record<string, unknown> = {}) => {
    const n = uniq();
    const body = { name: 'Amina Said', email: `amina${n}@example.com`, phone: phoneFor(n), password: PASSWORD, ...over };
    return { body, res: fetch(`${base}/store/auth/register`, json(body)) };
  };
  const login = (email: string, password: string) => fetch(`${base}/store/auth/login`, json({ email, password }));
  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  it('registers, returns tokens and the customer, and /store/me works with the token', async () => {
    const { body, res } = register();
    const r = await res;
    expect(r.status).toBe(201);
    const data = (await r.json()) as { customer: { id: string; email: string; phone: string }; accessToken: string; refreshToken: string };
    expect(data.customer.email).toBe(body.email);
    expect(data.customer.phone).toMatch(/^\+2547\d{8}$/);
    expect(data.accessToken.length).toBeGreaterThan(20);
    const me = await fetch(`${base}/store/me`, { headers: authed(data.accessToken) });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { email: string }).email).toBe(body.email);
  });

  it('lower-cases the email and rejects a duplicate regardless of case', async () => {
    const first = register({ email: 'MixedCase@Example.com' });
    expect((await first.res).status).toBe(201);
    const dup = register({ email: 'mixedcase@example.com' });
    expect((await dup.res).status).toBe(409);
  });

  it('rejects a phone that already has an account', async () => {
    const first = register();
    expect((await first.res).status).toBe(201);
    const dup = register({ phone: first.body.phone });
    expect((await dup.res).status).toBe(409);
  });

  it('rejects an invalid phone and weak passwords with 422', async () => {
    expect((await register({ phone: '12345' }).res).status).toBe(422);
    expect((await register({ password: 'short' }).res).status).toBe(422);
    expect((await register({ password: 'password12345' }).res).status).toBe(422);
  });

  it('gives 409 (not 500) when the same email registers twice at once', async () => {
    const n = uniq();
    const mk = (suffix: number) =>
      fetch(`${base}/store/auth/register`, json({ name: 'Race', email: `race${n}@example.com`, phone: phoneFor(900000 + n * 10 + suffix), password: PASSWORD }));
    const results = await Promise.all([mk(1), mk(2), mk(3)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  });

  it('claims an existing guest customer by phone', async () => {
    const prisma = app.get(PrismaService);
    const n = uniq();
    const guest = await prisma.customer.create({ data: { name: 'Guest Buyer', phone: `+2547${String(30000000 + n).slice(-8)}` } });
    const r = await register({ phone: `0${guest.phone.slice(4)}`, name: 'Now Registered' }).res;
    expect(r.status).toBe(201);
    expect(((await r.json()) as { customer: { id: string } }).customer.id).toBe(guest.id);
  });

  it('logs in with the right password and gives one generic error for every failure', async () => {
    const { body, res } = register();
    expect((await res).status).toBe(201);
    expect((await login(body.email, PASSWORD)).status).toBe(200);
    const wrong = await login(body.email, 'not-the-password-123');
    const unknown = await login('nobody-here@example.com', PASSWORD);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const a = (await wrong.json()) as { detail?: string };
    const b = (await unknown.json()) as { detail?: string };
    expect(a.detail ?? '').toBe(b.detail ?? '');
  });

  it('locks the account after five failed logins, even for the right password', async () => {
    const { body, res } = register();
    expect((await res).status).toBe(201);
    for (let i = 0; i < 5; i++) expect((await login(body.email, `wrong-password-${i}-xx`)).status).toBe(401);
    expect((await login(body.email, PASSWORD)).status).toBe(401);
  });

  it('rotates the refresh token and revokes the whole family when an old one is reused', async () => {
    const { res } = register();
    const first = (await (await res).json()) as { refreshToken: string };
    const refresh = (token: string) => fetch(`${base}/store/auth/refresh`, json({ refreshToken: token }));
    const second = await refresh(first.refreshToken);
    expect(second.status).toBe(200);
    const rotated = (await second.json()) as { refreshToken: string };
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect((await refresh(first.refreshToken)).status).toBe(401); // reuse of the rotated token
    expect((await refresh(rotated.refreshToken)).status).toBe(401); // family revoked
  });

  it('logout revokes the refresh token', async () => {
    const { res } = register();
    const t = (await (await res).json()) as { refreshToken: string };
    expect((await fetch(`${base}/store/auth/logout`, json({ refreshToken: t.refreshToken }))).status).toBe(204);
    expect((await fetch(`${base}/store/auth/refresh`, json({ refreshToken: t.refreshToken }))).status).toBe(401);
  });

  it('PATCH /store/me updates the name', async () => {
    const { res } = register();
    const t = (await (await res).json()) as { accessToken: string };
    const r = await fetch(`${base}/store/me`, json({ name: 'New Name' }, authed(t.accessToken), 'PATCH'));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { name: string }).name).toBe('New Name');
  });

  it('keeps customer and staff tokens apart in both directions', async () => {
    const { res } = register();
    const customer = (await (await res).json()) as { accessToken: string };
    expect((await fetch(`${base}/admin/me`, { headers: authed(customer.accessToken) })).status).toBe(401);
    const staffLogin = await fetch(`${base}/admin/auth/login`, json({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }));
    const staff = (await staffLogin.json()) as { accessToken: string };
    expect((await fetch(`${base}/admin/me`, { headers: authed(staff.accessToken) })).status).toBe(200);
    expect((await fetch(`${base}/store/me`, { headers: authed(staff.accessToken) })).status).toBe(401);
  });

  it('requires a token on /store/me', async () => {
    expect((await fetch(`${base}/store/me`)).status).toBe(401);
  });
});
