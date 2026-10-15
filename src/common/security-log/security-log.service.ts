import { Injectable, Logger } from '@nestjs/common';

export type SecurityEvent = 'register' | 'verification_sent' | 'verification_failed' | 'email_verified' | 'login_success' | 'login_failed' | 'account_locked' | 'refresh_reuse' | 'token_type_rejected' | 'rate_limited' | 'signature_rejected';

const SECRET_KEY = /password|token|secret|authorization|cookie/i;

/** `amina.said@example.com` -> `a***@example.com`. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 0) return '***';
  const local = email.slice(0, at);
  return `${local ? `${local[0]}***` : '***'}${email.slice(at)}`;
}

/** Removes secrets, masks emails and truncates long strings before anything reaches the log. */
export function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEY.test(k)) continue;
    if (typeof v === 'string') out[k] = /email/i.test(k) ? maskEmail(v) : v.slice(0, 200) + (v.length > 200 ? '…' : '');
    else out[k] = v;
  }
  return out;
}

/** Structured JSON log lines for security-relevant events (ASVS 7.1, ISO 27001 A.8.15). */
@Injectable()
export class SecurityLogService {
  private readonly logger = new Logger('security');

  log(event: SecurityEvent, fields: Record<string, unknown> = {}): void {
    this.logger.log(JSON.stringify({ event, at: new Date().toISOString(), ...sanitizeFields(fields) }));
  }
}
