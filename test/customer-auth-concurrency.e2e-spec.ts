import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/prisma/prisma.service';
import { bootApp, json } from './helpers/app';
import { lastCode, outbox, registerVerified, Session } from './helpers/auth';

jest.setTimeout(90_000);

const PASSWORD = 'Sunrise-over-Nairobi-42';
let seq = 500;
const phoneFor = (n: number) => `07${String(30000000 + n).slice(-8)}`;

describe('customer auth: names, parallel guesses and parallel resends', () => {
  let app: NestFastifyApplication;
  let base: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'false' }));
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  const newAccount = (over: Partial<{ name: string }> = {}) => {
    const n = ++seq;
    return { name: 'Amina Said', email: `conc${n}@example.com`, phone: phoneFor(n), password: PASSWORD, ...over };
  };
  const register = (body: ReturnType<typeof newAccount>) => fetch(`${base}/store/auth/register`, json(body));
  const verify = (email: string, code: string) => fetch(`${base}/store/auth/verify`, json({ email, code, password: PASSWORD }));
  const resend = (email: string) => fetch(`${base}/store/auth/resend`, json({ email }));
  const codeMails = (email: string) => outbox(app).filter((m) => m.to === email.toLowerCase() && /verification code/i.test(m.subject));

  describe('display name', () => {
    it('refuses a sign-up whose name is only spaces', async () => {
      const r = await register(newAccount({ name: '   ' }));
      expect(r.status).toBe(400);
    });

    it('trims the name it keeps', async () => {
      const acc = newAccount({ name: '  Amina Said  ' });
      expect((await register(acc)).status).toBe(201);
      const row = await prisma.customerAccount.findUnique({ where: { email: acc.email } });
      expect(row?.displayName).toBe('Amina Said');
    });

    it('refuses PATCH /store/me with a blank name', async () => {
      const acc = newAccount();
      const session: Session = await registerVerified(app, base, acc);
      const r = await fetch(`${base}/store/me`, json({ name: '   ' }, { authorization: `Bearer ${session.accessToken}` }, 'PATCH'));
      expect(r.status).toBe(400);
    });
  });

  describe('code guesses', () => {
    it('lets at most five wrong guesses through when they arrive in parallel, then refuses even the right code', async () => {
      const acc = newAccount();
      await register(acc);
      const real = lastCode(app, acc.email);
      const wrong = real === '000000' ? '111111' : '000000';
      const results = await Promise.all(Array.from({ length: 12 }, () => verify(acc.email, wrong)));
      const bodies = (await Promise.all(results.map((r) => r.json()))) as { code?: string }[];
      expect(bodies.filter((b) => b.code === 'invalid_code').length).toBeLessThanOrEqual(5);
      expect(bodies.filter((b) => b.code === 'too_many_attempts').length).toBeGreaterThanOrEqual(7);
      expect((await prisma.customerAccount.findUnique({ where: { email: acc.email } }))?.verifyAttempts).toBe(5);
      const late = await verify(acc.email, real);
      expect(late.status).toBe(400);
      expect(((await late.json()) as { code?: string }).code).toBe('too_many_attempts');
    });
  });

  describe('resend', () => {
    it('sends exactly one new code when five resend requests arrive together after the cool-down', async () => {
      const acc = newAccount();
      await register(acc);
      expect(codeMails(acc.email)).toHaveLength(1);
      await prisma.customerAccount.update({ where: { email: acc.email }, data: { verifySentAt: new Date(Date.now() - 120_000) } });
      const results = await Promise.all(Array.from({ length: 5 }, () => resend(acc.email)));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      await new Promise((r) => setTimeout(r, 400)); // mail is sent in the background
      expect(codeMails(acc.email)).toHaveLength(2);
    });
  });
});
