import { NestExpressApplication } from '@nestjs/platform-express';
import { bootApp, json } from './helpers/app';
import { startSmtp, TestSmtp } from './helpers/smtp';

jest.setTimeout(60_000);

const PASSWORD = 'Sunrise-over-Nairobi-42';
let seq = 0;
const account = (over: Record<string, unknown> = {}) => {
  const n = ++seq;
  return { name: 'Amina Said', email: `flow${n}@example.com`, phone: `07${String(20000000 + n).slice(-8)}`, password: PASSWORD, ...over };
};

describe('verification and welcome emails over real SMTP', () => {
  let smtp: TestSmtp;
  let app: NestExpressApplication;
  let base: string;
  beforeAll(async () => {
    smtp = await startSmtp();
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'false', SMTP_URL: smtp.url, MAIL_FROM: 'Jabali <orders@jabali.test>', STORE_URL: 'https://shop.example.com' }));
  });
  afterAll(async () => {
    await app.close();
    await smtp.close();
  });

  it('sends the code after sign-up and the welcome email only after the code is confirmed', async () => {
    const acc = account();
    const before = smtp.messages.length;
    expect((await fetch(`${base}/store/auth/register`, json(acc))).status).toBe(201);
    const [first] = (await smtp.waitFor(before + 1)).slice(before);
    expect((first.to as { text: string }).text).toContain(acc.email);
    expect(first.from?.text).toContain('orders@jabali.test');
    expect(first.subject).toBe('Your Jabali verification code');
    expect(first.html).toContain('Amina');
    const code = /\b(\d{6})\b/.exec(first.text ?? '')?.[1];
    expect(code).toBeDefined();

    // nothing else has been sent yet: no welcome before activation
    await new Promise((r) => setTimeout(r, 300));
    expect(smtp.messages.length).toBe(before + 1);

    const verified = await fetch(`${base}/store/auth/verify`, json({ email: acc.email, code, password: acc.password }));
    expect(verified.status).toBe(200);
    const [, welcome] = (await smtp.waitFor(before + 2)).slice(before);
    expect((welcome.to as { text: string }).text).toContain(acc.email);
    expect(welcome.subject).toBe('Welcome to Jabali');
    expect(welcome.html).toMatch(/verified/i);
    expect(welcome.text).toContain('https://shop.example.com/shop');
  });

  it('sends nothing when sign-up is rejected', async () => {
    const before = smtp.messages.length;
    expect((await fetch(`${base}/store/auth/register`, json(account({ password: 'short' })))).status).toBe(422);
    await new Promise((r) => setTimeout(r, 300));
    expect(smtp.messages.length).toBe(before);
  });
});

describe('sign-up when the mail server is down', () => {
  let app: NestExpressApplication;
  let base: string;
  beforeAll(async () => {
    const smtp = await startSmtp();
    const deadUrl = smtp.url;
    await smtp.close(); // the port is now closed
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'false', SMTP_URL: deadUrl }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('still succeeds, quickly (the email is retried in the background)', async () => {
    const t = Date.now();
    const r = await fetch(`${base}/store/auth/register`, json(account()));
    expect(r.status).toBe(201);
    expect(Date.now() - t).toBeLessThan(5_000);
  });
});
