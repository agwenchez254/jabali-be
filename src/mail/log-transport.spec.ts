import { FactoryProvider, Logger } from '@nestjs/common';
import type { AppConfig } from '../config/config';
import { LogTransport, mailTransportProvider, OutgoingMail } from './mail.service';
import { verificationCodeEmail } from './templates/verification';
import { welcomeEmail } from './templates/welcome';

const mailOf = (content: { subject: string; html: string; text: string }, to = 'amina@example.com'): OutgoingMail => ({ from: 'Jabali <no-reply@jabali.co.ke>', to, ...content });
const codeMail = () => mailOf(verificationCodeEmail({ name: 'Amina Said', code: '042917', minutes: 10, storeUrl: 'https://shop.example.com' }));

describe('LogTransport (no SMTP server configured)', () => {
  let lines: string[];
  beforeEach(() => {
    lines = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => void lines.push(String(m)));
  });
  afterEach(() => jest.restoreAllMocks());

  it('prints the verification code and address so sign-up can be finished in development', async () => {
    await new LogTransport().sendMail(codeMail());
    const shown = lines.find((l) => l.includes('042917'));
    expect(shown).toBeDefined();
    expect(shown).toContain('amina@example.com');
    expect(shown).toMatch(/DEV ONLY/);
  });

  it('prints nothing sensitive for other emails: no body, no links', async () => {
    await new LogTransport().sendMail(mailOf(welcomeEmail({ name: 'Amina Said', storeUrl: 'https://shop.example.com' })));
    const all = lines.join('\n');
    expect(all).toContain('Welcome to Jabali');
    expect(all).not.toMatch(/https:\/\/shop\.example\.com|Pay with M-Pesa|Sharp suits/);
    expect(all).not.toMatch(/\b\d{6}\b/);
  });

  it('never prints the code when code logging is off', async () => {
    await new LogTransport(false).sendMail(codeMail());
    expect(lines.join('\n')).not.toContain('042917');
    expect(lines.join('\n')).not.toContain('amina@example.com'); // address stays masked
  });

  it('still keeps the message in the in-memory outbox for tests', async () => {
    const t = new LogTransport();
    await t.sendMail(codeMail());
    expect(t.outbox).toHaveLength(1);
    expect(t.outbox[0].text).toContain('042917');
  });
});

describe('mail transport provider', () => {
  const factory = (mailTransportProvider as FactoryProvider).useFactory as (cfg: AppConfig) => { sendMail: (m: OutgoingMail) => Promise<unknown> };
  const cfg = (nodeEnv: string) => ({ nodeEnv, mail: { smtpUrl: undefined } }) as unknown as AppConfig;

  it('prints codes in development and test when there is no SMTP_URL', async () => {
    const lines: string[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => void lines.push(String(m)));
    await factory(cfg('development')).sendMail(codeMail());
    await factory(cfg('test')).sendMail(codeMail());
    expect(lines.filter((l) => l.includes('042917'))).toHaveLength(2);
    jest.restoreAllMocks();
  });

  it('never prints a code in production, even if it somehow ends up without an SMTP server', async () => {
    const lines: string[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => void lines.push(String(m)));
    await factory(cfg('production')).sendMail(codeMail());
    expect(lines.join('\n')).not.toContain('042917');
    jest.restoreAllMocks();
  });
});
