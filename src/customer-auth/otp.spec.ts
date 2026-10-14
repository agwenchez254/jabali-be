import { codesMatch, generateCode, hashCode, OTP } from './otp';

describe('generateCode', () => {
  it('is always six digits, including leading zeros', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = generateCode();
      expect(c).toMatch(/^\d{6}$/);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(1900); // not a constant or a tiny range
  });
});

describe('hashCode', () => {
  it('is deterministic and never contains the code', () => {
    const h = hashCode('123456', 'acc-1', 'secret-secret-secret-secret-1234');
    expect(h).toBe(hashCode('123456', 'acc-1', 'secret-secret-secret-secret-1234'));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('123456');
  });
  it('differs per code, per account and per secret', () => {
    const base = hashCode('123456', 'acc-1', 'secret-secret-secret-secret-1234');
    expect(hashCode('123457', 'acc-1', 'secret-secret-secret-secret-1234')).not.toBe(base);
    expect(hashCode('123456', 'acc-2', 'secret-secret-secret-secret-1234')).not.toBe(base);
    expect(hashCode('123456', 'acc-1', 'another-secret-another-secret-12345')).not.toBe(base);
  });
});

describe('codesMatch', () => {
  it('compares hashes without throwing on odd input', () => {
    const h = hashCode('123456', 'a', 's'.repeat(32));
    expect(codesMatch(h, h)).toBe(true);
    expect(codesMatch(h, hashCode('654321', 'a', 's'.repeat(32)))).toBe(false);
    expect(codesMatch(h, '')).toBe(false);
    expect(codesMatch(h, 'short')).toBe(false);
  });
});

describe('OTP policy', () => {
  it('has the agreed limits', () => {
    expect(OTP).toEqual({ ttlMinutes: 10, maxAttempts: 5, resendCooldownSeconds: 60, maxSendsPerHour: 5 });
  });
});
