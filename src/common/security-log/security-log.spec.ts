import { Logger } from '@nestjs/common';
import { maskEmail, sanitizeFields, SecurityLogService } from './security-log.service';

describe('maskEmail', () => {
  it('keeps the first character and the domain', () => {
    expect(maskEmail('amina.said@example.com')).toBe('a***@example.com');
  });
  it('handles odd input without throwing', () => {
    expect(maskEmail('nope')).toBe('***');
    expect(maskEmail('')).toBe('***');
    expect(maskEmail('@x.co')).toBe('***@x.co');
  });
});

describe('sanitizeFields', () => {
  it('drops secrets and masks emails', () => {
    const out = sanitizeFields({ email: 'amina@example.com', password: 'hunter2', refreshToken: 'r', accessToken: 'a', token: 't', secret: 's', ip: '1.2.3.4', accountId: 'x' });
    expect(out).toEqual({ email: 'a***@example.com', ip: '1.2.3.4', accountId: 'x' });
  });
  it('truncates very long strings', () => {
    const out = sanitizeFields({ userAgent: 'u'.repeat(1000) }) as { userAgent: string };
    expect(out.userAgent.length).toBeLessThanOrEqual(201);
  });
});

describe('SecurityLogService', () => {
  it('writes one structured JSON line per event', () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    new SecurityLogService().log('login_failed', { email: 'amina@example.com', ip: '1.2.3.4', password: 'nope' });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;
    expect(line).toMatchObject({ event: 'login_failed', email: 'a***@example.com', ip: '1.2.3.4' });
    expect(line.password).toBeUndefined();
    expect(typeof line.at).toBe('string');
    spy.mockRestore();
  });
});
