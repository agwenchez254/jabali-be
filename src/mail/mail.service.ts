import { Inject, Injectable, Logger, Provider } from '@nestjs/common';
import { Resend } from 'resend';
import { maskEmail } from '../common/security-log/security-log.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { orderConfirmationEmail, ReceiptOrder } from './templates/order-confirmation';
import { verificationCodeEmail } from './templates/verification';
import { welcomeEmail } from './templates/welcome';

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

/** The six digits of a verification-code email, or undefined for any other message. */
const verificationCodeIn = (mail: OutgoingMail): string | undefined => (/verification code/i.test(mail.subject) ? /\b(\d{6})\b/.exec(mail.text)?.[1] : undefined);

/**
 * Used when no Resend API key is configured (development and test): nothing leaves the machine.
 * With `showCodes` it also prints a verification code in the API terminal so sign-up can be finished without an email
 * service. That is safe only because production config refuses to start without an API key, and the provider below
 * passes `showCodes = false` in production as a second guard. No other message content is ever printed.
 */
export class LogTransport implements MailTransport {
  readonly outbox: OutgoingMail[] = [];
  private readonly log = new Logger('Mail');

  constructor(private readonly showCodes = true) { }

  sendMail(mail: OutgoingMail): Promise<{ messageId?: string }> {
    this.outbox.push(mail);
    if (this.outbox.length > 50) this.outbox.shift();
    this.log.log(`Resend API key is not set, so this email was not sent: "${mail.subject}" to ${maskEmail(mail.to)}`);
    const code = this.showCodes ? verificationCodeIn(mail) : undefined;
    if (code) this.log.log(`DEV ONLY (no mail service configured) | verification code for ${mail.to}: ${code}`);
    return Promise.resolve({ messageId: 'log-only' });
  }
}

/**
 * Production-ready transport using the official Resend SDK.
 */
export class ResendTransport implements MailTransport {
  private readonly resend: Resend;

  constructor(apiKey: string) {
    this.resend = new Resend(apiKey);
  }

  async sendMail(mail: OutgoingMail): Promise<{ messageId?: string }> {
    const response = await this.resend.emails.send({
      from: mail.from,
      to: mail.to,
      replyTo: mail.replyTo,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    if (response.error) {
      throw new Error(response.error.message);
    }

    return { messageId: response.data?.id };
  }
}

export const mailTransportProvider: Provider = {
  provide: MAIL_TRANSPORT,
  inject: [APP_CONFIG],
  useFactory: (cfg: AppConfig): MailTransport => {
    // Assuming your AppConfig has a mail.apiKey property for Resend.
    // Fall back to cfg.mail.smtpUrl or process.env.RESEND_API_KEY if needed.
    const apiKey = cfg.mail.apiKey || process.env.RESEND_API_KEY;

    return apiKey
      ? new ResendTransport(apiKey)
      : new LogTransport(cfg.nodeEnv !== 'production');
  },
};

@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  /** Delay before each attempt, in milliseconds. Three attempts by default. */
  retryDelaysMs: number[] = [0, 2_000, 10_000];

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) { }

  /** Resolves true once Resend accepted the message. Never throws. */
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

  /** The account-activation code. */
  sendVerificationCode(to: string, name: string, code: string, minutes: number): void {
    this.queue({ to, ...verificationCodeEmail({ name, code, minutes, storeUrl: this.cfg.mail.storeUrl }) });
  }

  /** Sent once, when the account is activated. */
  sendWelcome(to: string, name: string): void {
    this.queue({ to, ...welcomeEmail({ name, storeUrl: this.cfg.mail.storeUrl }) });
  }

  /** Order confirmation with the receipt in the body. */
  sendOrderConfirmation(to: string, order: ReceiptOrder): void {
    this.queue({ to, ...orderConfirmationEmail({ order, storeUrl: this.cfg.mail.storeUrl }) });
  }
}