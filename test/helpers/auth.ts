import { NestExpressApplication } from '@nestjs/platform-express';
import { LogTransport, MAIL_TRANSPORT, OutgoingMail } from '../../src/mail/mail.service';
import { json } from './app';

/** Mail captured by the log-only transport (the e2e app has no SMTP server). */
export const outbox = (app: NestExpressApplication): OutgoingMail[] => (app.get(MAIL_TRANSPORT) as LogTransport).outbox;

/** The newest verification code emailed to `to`. */
export function lastCode(app: NestExpressApplication, to: string): string {
  const mail = [...outbox(app)].reverse().find((m) => m.to === to.toLowerCase() && /verification code/i.test(m.subject));
  const code = mail ? /\b(\d{6})\b/.exec(mail.text)?.[1] : undefined;
  if (!code) throw new Error(`no verification code email for ${to}`);
  return code;
}

export interface Session {
  customer: { id: string; name: string; email: string; phone: string };
  accessToken: string;
  refreshToken: string;
}

export interface NewAccount {
  name: string;
  email: string;
  phone: string;
  password: string;
}

/** Registers an account and activates it with the emailed code, returning its session. */
export async function registerVerified(app: NestExpressApplication, base: string, body: NewAccount): Promise<Session> {
  const reg = await fetch(`${base}/store/auth/register`, json(body));
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${await reg.text()}`);
  const res = await fetch(`${base}/store/auth/verify`, json({ email: body.email, code: lastCode(app, body.email) }));
  if (res.status !== 200) throw new Error(`verify failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as Session;
}
