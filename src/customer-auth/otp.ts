import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** Email verification code policy (ASVS 2.2.x, 2.7.x). */
export const OTP = {
  ttlMinutes: 10,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  maxSendsPerHour: 5,
} as const;

/** A uniformly random six-digit code, zero-padded. */
export const generateCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Only this hash is stored. It is keyed by the account and a server secret, so a code cannot be replayed across accounts. */
export const hashCode = (code: string, accountId: string, secret: string): string =>
  createHmac('sha256', secret).update(`${accountId}:${code}`).digest('hex');

/** Constant-time comparison of two hex hashes. Anything malformed is simply "no match". */
export function codesMatch(expectedHash: string, actualHash: string): boolean {
  const a = Buffer.from(expectedHash, 'hex');
  const b = Buffer.from(actualHash, 'hex');
  return a.length === 32 && a.length === b.length && timingSafeEqual(a, b);
}
