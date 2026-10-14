import { checkPassword, PASSWORD_MAX, PASSWORD_MIN } from './password-policy';

describe('checkPassword', () => {
  const email = 'amina.said@example.com';

  it('accepts a long, unusual password', () => {
    expect(checkPassword('correct horse battery staple', email)).toBeNull();
  });

  it('rejects passwords shorter than the minimum', () => {
    expect(checkPassword('a'.repeat(PASSWORD_MIN - 1), email)).toMatch(/at least 12/);
  });

  it('accepts exactly the minimum length', () => {
    expect(checkPassword('Tr4mpoline-Bk', email)).toBeNull();
  });

  it('rejects passwords longer than the maximum', () => {
    expect(checkPassword('x1'.repeat(PASSWORD_MAX), email)).toMatch(/at most 128/);
  });

  it('rejects common passwords, ignoring case', () => {
    expect(checkPassword('PASSWORD12345', email)).toMatch(/too common/);
    expect(checkPassword('qwertyuiop12', email)).toMatch(/too common/);
  });

  it('rejects a single repeated character', () => {
    expect(checkPassword('z'.repeat(14), email)).toMatch(/too easy to guess/);
  });

  it('rejects the email itself and its local part', () => {
    expect(checkPassword('Amina.Said@Example.com', email)).toMatch(/email/);
    expect(checkPassword('xx-amina.said-xx-1', email)).toMatch(/email/);
  });

  it('ignores very short email local parts', () => {
    expect(checkPassword('abcd-efgh-ijkl-mnop', 'ab@example.com')).toBeNull();
  });

  it('counts characters, not bytes', () => {
    expect(checkPassword('🔐'.repeat(12), email)).toMatch(/too easy to guess/);
  });
});
