import { Inject, Injectable, Logger, Provider } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { maskEmail } from '../common/security-log/security-log.service';
import { APP_CONFIG, AppConfig } from '../config/config';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export interface OutgoingMail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailTransport {
  sendMail(mail: OutgoingMail): Promise<{ messageId?: string }>;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const RECIPIENT = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/;

/** One line, bounded: a subject can never carry extra headers. */
export const cleanSubject = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref();
  });

/** Used when no SMTP server is configured (development and test): nothing leaves the machine. */
export class LogTransport implements MailTransport {
  readonly outbox: OutgoingMail[] = [];
  private readonly log = new Logger('Mail');

  sendMail(mail: OutgoingMail): Promise<{ messageId?: string }> {
    this.outbox.push(mail);
    if (this.outbox.length > 50) this.outbox.shift();
    this.log.log(`SMTP_URL is not set, so this email was not sent: "${mail.subject}" to ${maskEmail(mail.to)}`);
    return Promise.resolve({ messageId: 'log-only' });
  }
}

export const mailTransportProvider: Provider = {
  provide: MAIL_TRANSPORT,
  inject: [APP_CONFIG],
  useFactory: (cfg: AppConfig): MailTransport =>
    cfg.mail.smtpUrl
      ? (nodemailer.createTransport({
          url: cfg.mail.smtpUrl,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
          // Never send credentials or customer data over a plaintext SMTP session in production.
          requireTLS: cfg.nodeEnv === 'production' && cfg.mail.smtpUrl.startsWith('smtp:'),
        }) as unknown as MailTransport)
      : new LogTransport(),
};

@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  /** Delay before each attempt, in milliseconds. Three attempts by default. */
  retryDelaysMs: number[] = [0, 2_000, 10_000];

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Resolves true once the SMTP server accepted the message. Never throws. */
  async send(msg: MailMessage): Promise<boolean> {
    if (!RECIPIENT.test(msg.to)) {
      this.log.warn('Skipped an email: invalid recipient address');
      return false;
    }
    const mail: OutgoingMail = {
      from: this.cfg.mail.from,
      to: msg.to,
      replyTo: this.cfg.mail.replyTo,
      subject: cleanSubject(msg.subject),
      html: msg.html,
      text: msg.text,
    };
    const attempts = this.retryDelaysMs.length;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (this.retryDelaysMs[attempt] > 0) await sleep(this.retryDelaysMs[attempt]);
      try {
        const info = await this.transport.sendMail(mail);
        this.log.log(`Sent "${mail.subject}" to ${maskEmail(mail.to)} (${info.messageId ?? 'no id'})`);
        return true;
      } catch (e) {
        this.log.warn(`Attempt ${attempt + 1}/${attempts} to email ${maskEmail(mail.to)} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.log.error(`Giving up on "${mail.subject}" to ${maskEmail(mail.to)}`);
    return false;
  }

  /** Fire and forget: mail never blocks or fails a request. */
  queue(msg: MailMessage): void {
    void this.send(msg);
  }
}
