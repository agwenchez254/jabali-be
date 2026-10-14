import * as nodemailer from 'nodemailer';
import { loadConfig } from '../src/config/config';
import { MailService, MailTransport } from '../src/mail/mail.service';
import { startSmtp, TestSmtp } from './helpers/smtp';

jest.setTimeout(30_000);

const env = { DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: 'x'.repeat(40) };

describe('SMTP delivery', () => {
  let smtp: TestSmtp;
  beforeAll(async () => {
    smtp = await startSmtp();
  });
  afterAll(async () => {
    await smtp.close();
  });

  it('delivers a multipart message over a real SMTP connection', async () => {
    const cfg = loadConfig({ ...env, SMTP_URL: smtp.url, MAIL_FROM: 'Jabali <orders@jabali.test>', MAIL_REPLY_TO: 'help@jabali.test' });
    const mail = new MailService(nodemailer.createTransport(cfg.mail.smtpUrl!) as unknown as MailTransport, cfg);
    const ok = await mail.send({ to: 'amina@example.com', subject: 'Hello Amina', html: '<p>Hi <b>Amina</b></p>', text: 'Hi Amina' });
    expect(ok).toBe(true);
    const [m] = await smtp.waitFor(1);
    expect(m.from?.text).toContain('orders@jabali.test');
    expect(m.replyTo?.text).toContain('help@jabali.test');
    expect((m.to as { text: string }).text).toContain('amina@example.com');
    expect(m.subject).toBe('Hello Amina');
    expect(m.html).toContain('<b>Amina</b>');
    expect((m.text ?? '').trim()).toBe('Hi Amina');
  });

  it('returns false (without throwing) after retries when the server is unreachable', async () => {
    const cfg = loadConfig({ ...env, SMTP_URL: 'smtp://127.0.0.1:1' });
    const mail = new MailService(nodemailer.createTransport(cfg.mail.smtpUrl!) as unknown as MailTransport, cfg);
    mail.retryDelaysMs = [0, 0, 0];
    await expect(mail.send({ to: 'amina@example.com', subject: 'x', html: '<p>x</p>', text: 'x' })).resolves.toBe(false);
  });
});
