import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/prisma/prisma.service';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './global-setup';
import { bootApp, json } from './helpers/app';
import { lastCode, outbox, registerVerified, Session } from './helpers/auth';

jest.setTimeout(90_000);

const PASSWORD = 'Sunrise-over-Nairobi-42';
let seq = 0;
const uniq = () => ++seq;
const phoneFor = (n: number) => `07${String(10000000 + n).slice(-8)}`; // 07 + 8 digits

describe('customer auth', () => {
  let app: NestExpressApplication;
  let base: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'false' }));
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  const newAccount = (over: Partial<{ name: string; email: string; phone: string; password: string }> = {}) => {
    const n = uniq();
    return { name: 'Amina Said', email: `amina${n}@example.com`, phone: phoneFor(n), password: PASSWORD, ...over };
  };
  const register = (body: ReturnType<typeof newAccount>) => fetch(`${base}/store/auth/register`, json(body));
  const verify = (email: string, code: string) => fetch(`${base}/store/auth/verify`, json({ email, code }));
  const resend = (email: string) => fetch(`${base}/store/auth/resend`, json({ email }));
  const login = (email: string, password: string) => fetch(`${base}/store/auth/login`, json({ email, password }));
  const authed = (token: string) => ({ authorization: `Bearer ${token}` });
  const accountOf = (email: string) => prisma.customerAccount.findUnique({ where: { email: email.toLowerCase() } });
  const mailsTo = (email: string) => outbox(app).filter((m) => m.to === email.toLowerCase());

  describe('sign-up and email verification', () => {
    it('creates a pending account, emails a code and issues no tokens', async () => {
      const acc = newAccount();
      const r = await register(acc);
      expect(r.status).toBe(201);
      const body = (await r.json()) as Record<string, unknown>;
      expect(body).toEqual({ email: acc.email, expiresInSeconds: 600, resendAfterSeconds: 60 });
      expect(body.accessToken).toBeUndefined();
      expect((await accountOf(acc.email))?.emailVerifiedAt).toBeNull();
      expect(lastCode(app, acc.email)).toMatch(/^\d{6}$/);
      expect(mailsTo(acc.email).map((m) => m.subject)).toEqual(['Your Jabali verification code']);
    });

    it('never stores or returns the code in clear', async () => {
      const acc = newAccount();
      await register(acc);
      const row = await accountOf(acc.email);
      expect(row?.verifyCodeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row?.verifyCodeHash).not.toContain(lastCode(app, acc.email));
    });

    it('activates the account with the right code, issues tokens and sends the welcome email only then', async () => {
      const acc = newAccount();
      await register(acc);
      expect(mailsTo(acc.email).some((m) => m.subject === 'Welcome to Jabali')).toBe(false);
      const r = await verify(acc.email, lastCode(app, acc.email));
      expect(r.status).toBe(200);
      const session = (await r.json()) as Session;
      expect(session.customer.email).toBe(acc.email);
      expect(session.customer.phone).toMatch(/^\+2547\d{8}$/);
      expect(session.accessToken.length).toBeGreaterThan(20);
      expect((await accountOf(acc.email))?.emailVerifiedAt).not.toBeNull();
      expect(mailsTo(acc.email).map((m) => m.subject)).toEqual(['Your Jabali verification code', 'Welcome to Jabali']);
      const me = await fetch(`${base}/store/me`, { headers: authed(session.accessToken) });
      expect(me.status).toBe(200);
    });

    it('rejects a code once it has been used', async () => {
      const acc = newAccount();
      await register(acc);
      const code = lastCode(app, acc.email);
      expect((await verify(acc.email, code)).status).toBe(200);
      expect((await verify(acc.email, code)).status).toBe(400);
    });

    it('rejects a wrong code with the remaining attempts, and voids the code after five misses', async () => {
      const acc = newAccount();
      await register(acc);
      const right = lastCode(app, acc.email);
      const wrong = right === '000000' ? '000001' : '000000';
      const first = await verify(acc.email, wrong);
      expect(first.status).toBe(400);
      expect(((await first.json()) as { code?: string; remainingAttempts?: number })).toMatchObject({ code: 'invalid_code', remainingAttempts: 4 });
      for (let i = 0; i < 4; i++) expect((await verify(acc.email, wrong)).status).toBe(400);
      const voided = await verify(acc.email, right);
      expect(voided.status).toBe(400);
      expect(((await voided.json()) as { code?: string }).code).toBe('too_many_attempts');
      expect((await accountOf(acc.email))?.emailVerifiedAt).toBeNull();
    });

    it('rejects an expired code', async () => {
      const acc = newAccount();
      await register(acc);
      await prisma.customerAccount.update({ where: { email: acc.email }, data: { verifyExpiresAt: new Date(Date.now() - 1000) } });
      const r = await verify(acc.email, lastCode(app, acc.email));
      expect(r.status).toBe(400);
      expect(((await r.json()) as { code?: string }).code).toBe('code_expired');
    });

    it('answers the same way for an unknown email, a malformed code and a verified account', async () => {
      const unknown = await verify('nobody.here@example.com', '123456');
      expect(unknown.status).toBe(400);
      expect(((await unknown.json()) as { code?: string }).code).toBe('invalid_code');
      const s = await registerVerified(app, base, newAccount());
      expect((await verify(s.customer.email, '123456')).status).toBe(400);
      expect((await verify(s.customer.email, 'abcdef')).status).toBe(400);
    });

    it('does not let sign-in through before verification, but only after the right password', async () => {
      const acc = newAccount();
      await register(acc);
      const blocked = await login(acc.email, acc.password);
      expect(blocked.status).toBe(403);
      expect(((await blocked.json()) as { code?: string }).code).toBe('email_not_verified');
      expect((await login(acc.email, 'not-the-password-123')).status).toBe(401);
    });
  });

  describe('resending the code', () => {
    const codeMails = (email: string) => mailsTo(email).filter((m) => /verification code/i.test(m.subject));

    it('quietly ignores a request during the 60 second cool-down, then issues a fresh code that replaces the old one', async () => {
      const acc = newAccount();
      await register(acc);
      const old = lastCode(app, acc.email);
      const tooSoon = await resend(acc.email);
      expect(tooSoon.status).toBe(200);
      expect(await tooSoon.json()).toEqual({ resendAfterSeconds: 60 });
      expect(codeMails(acc.email)).toHaveLength(1); // nothing new was sent

      await prisma.customerAccount.update({ where: { email: acc.email }, data: { verifySentAt: new Date(Date.now() - 61_000) } });
      const ok = await resend(acc.email);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ resendAfterSeconds: 60 });
      expect(codeMails(acc.email)).toHaveLength(2);
      const fresh = lastCode(app, acc.email);
      if (fresh !== old) expect((await verify(acc.email, old)).status).toBe(400);
      expect((await verify(acc.email, fresh)).status).toBe(200);
    });

    it('sends at most five codes an hour and answers the same either way', async () => {
      const acc = newAccount();
      await register(acc); // send 1
      for (let i = 0; i < 4; i++) {
        await prisma.customerAccount.update({ where: { email: acc.email }, data: { verifySentAt: new Date(Date.now() - 61_000) } });
        expect((await resend(acc.email)).status).toBe(200); // sends 2..5
      }
      expect(codeMails(acc.email)).toHaveLength(5);
      await prisma.customerAccount.update({ where: { email: acc.email }, data: { verifySentAt: new Date(Date.now() - 61_000) } });
      const sixth = await resend(acc.email);
      expect(sixth.status).toBe(200);
      expect(await sixth.json()).toEqual({ resendAfterSeconds: 60 });
      expect(codeMails(acc.email)).toHaveLength(5); // the sixth was not sent
    });

    it('says nothing about unknown or already verified emails and sends no mail', async () => {
      const before = outbox(app).length;
      const unknown = await resend('ghost@example.com');
      expect(unknown.status).toBe(200);
      const s = await registerVerified(app, base, newAccount());
      const count = outbox(app).length;
      const verified = await resend(s.customer.email);
      expect(verified.status).toBe(200);
      expect(await verified.json()).toEqual({ resendAfterSeconds: 60 });
      expect(outbox(app).length).toBe(count);
      expect(outbox(app).filter((m) => m.to === 'ghost@example.com')).toHaveLength(0);
      expect(before).toBeLessThanOrEqual(count);
    });
  });

  describe('sign-up conflicts and abuse', () => {
    it('lower-cases the email and rejects a verified duplicate regardless of case', async () => {
      await registerVerified(app, base, newAccount({ email: 'MixedCase@Example.com' }));
      const dup = await register(newAccount({ email: 'mixedcase@example.com' }));
      expect(dup.status).toBe(409);
    });

    it('rejects a phone that already belongs to a verified account or a live pending sign-up', async () => {
      const verified = await registerVerified(app, base, newAccount());
      expect((await register(newAccount({ phone: verified.customer.phone.replace('+254', '0') }))).status).toBe(409);
      const pending = newAccount();
      await register(pending);
      expect((await register(newAccount({ phone: pending.phone }))).status).toBe(409);
    });

    it('re-registering a pending email only re-sends the code and never changes the password', async () => {
      const acc = newAccount();
      await register(acc);
      await prisma.customerAccount.update({ where: { email: acc.email }, data: { verifySentAt: new Date(Date.now() - 61_000) } });
      const again = await register({ ...acc, password: 'Attacker-chosen-password-9' });
      expect(again.status).toBe(201);
      expect((await verify(acc.email, lastCode(app, acc.email))).status).toBe(200);
      expect((await login(acc.email, acc.password)).status).toBe(200);
      expect((await login(acc.email, 'Attacker-chosen-password-9')).status).toBe(401);
    });

    it('frees the phone and email of an abandoned sign-up once its code has expired', async () => {
      const abandoned = newAccount();
      await register(abandoned);
      await prisma.customerAccount.update({ where: { email: abandoned.email }, data: { verifyExpiresAt: new Date(Date.now() - 1000) } });
      const taker = newAccount({ phone: abandoned.phone });
      expect((await register(taker)).status).toBe(201);
      expect(await accountOf(abandoned.email)).toBeNull();
      expect((await verify(taker.email, lastCode(app, taker.email))).status).toBe(200);
    });

    it('rejects an invalid phone and weak passwords with 422', async () => {
      expect((await register(newAccount({ phone: '12345' }))).status).toBe(422);
      expect((await register(newAccount({ password: 'short' }))).status).toBe(422);
      expect((await register(newAccount({ password: 'password12345' }))).status).toBe(422);
    });

    it('never answers 5xx when the same email signs up many times at once', async () => {
      const n = uniq();
      const email = `race${n}@example.com`;
      const mk = (suffix: number) => register({ name: 'Race', email, phone: phoneFor(900000 + n * 10 + suffix), password: PASSWORD });
      const results = await Promise.all([mk(1), mk(2), mk(3)]);
      for (const r of results) expect(r.status).toBeLessThan(500);
      expect(await prisma.customerAccount.count({ where: { email } })).toBe(1);
    });

    it('claims an existing guest customer by phone once the email is verified', async () => {
      const n = uniq();
      const guest = await prisma.customer.create({ data: { name: 'Guest Buyer', phone: `+2547${String(30000000 + n).slice(-8)}` } });
      const s = await registerVerified(app, base, newAccount({ phone: `0${guest.phone.slice(4)}`, name: 'Now Registered' }));
      expect(s.customer.id).toBe(guest.id);
    });
  });

  describe('sessions', () => {
    it('logs in with the right password and gives one generic error for every failure', async () => {
      const s = await registerVerified(app, base, newAccount());
      expect((await login(s.customer.email, PASSWORD)).status).toBe(200);
      const wrong = await login(s.customer.email, 'not-the-password-123');
      const unknown = await login('nobody-here@example.com', PASSWORD);
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      const a = (await wrong.json()) as { detail?: string };
      const b = (await unknown.json()) as { detail?: string };
      expect(a.detail ?? '').toBe(b.detail ?? '');
    });

    it('locks the account after five failed logins, even for the right password', async () => {
      const s = await registerVerified(app, base, newAccount());
      for (let i = 0; i < 5; i++) expect((await login(s.customer.email, `wrong-password-${i}-xx`)).status).toBe(401);
      expect((await login(s.customer.email, PASSWORD)).status).toBe(401);
    });

    it('rotates the refresh token and revokes the whole family when an old one is reused', async () => {
      const first = await registerVerified(app, base, newAccount());
      const refresh = (token: string) => fetch(`${base}/store/auth/refresh`, json({ refreshToken: token }));
      const second = await refresh(first.refreshToken);
      expect(second.status).toBe(200);
      const rotated = (await second.json()) as { refreshToken: string };
      expect(rotated.refreshToken).not.toBe(first.refreshToken);
      expect((await refresh(first.refreshToken)).status).toBe(401); // reuse of the rotated token
      expect((await refresh(rotated.refreshToken)).status).toBe(401); // family revoked
    });

    it('logout revokes the refresh token', async () => {
      const t = await registerVerified(app, base, newAccount());
      expect((await fetch(`${base}/store/auth/logout`, json({ refreshToken: t.refreshToken }))).status).toBe(204);
      expect((await fetch(`${base}/store/auth/refresh`, json({ refreshToken: t.refreshToken }))).status).toBe(401);
    });

    it('PATCH /store/me updates the name', async () => {
      const t = await registerVerified(app, base, newAccount());
      const r = await fetch(`${base}/store/me`, json({ name: 'New Name' }, authed(t.accessToken), 'PATCH'));
      expect(r.status).toBe(200);
      expect(((await r.json()) as { name: string }).name).toBe('New Name');
    });

    it('keeps customer and staff tokens apart in both directions', async () => {
      const customer = await registerVerified(app, base, newAccount());
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
});
