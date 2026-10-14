export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Common passwords that are long enough to pass the length rule (lowercase). */
const COMMON = new Set([
  'password1234',
  'password12345',
  'password123456',
  'password!234',
  'passw0rd1234',
  '123456789012',
  '1234567890123',
  '12345678901234',
  'qwertyuiop12',
  'qwertyuiopas',
  'qwertyuiop123',
  'qwertyuiopasdf',
  'iloveyou1234',
  'administrator',
  'welcome12345',
  'letmein12345',
  'abcdefghijkl',
  'abcdefghijklmnop',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  'qazwsxedcrfv',
  'changeme1234',
  'jabali123456',
  'jabali@12345',
  'kenya1234567',
  'nairobi12345',
  'trustno1trustno1',
  'monkey123456',
]);

/** A user-facing reason the password is unacceptable, or null when it is fine. */
export function checkPassword(password: string, email: string): string | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common';
  if (/^(.)\1+$/u.test(password)) return 'That password is too easy to guess';
  const mail = email.trim().toLowerCase();
  const local = mail.split('@')[0] ?? '';
  if (lower === mail || (local.length >= 6 && lower.includes(local))) return 'Do not use your email in your password';
  return null;
}
