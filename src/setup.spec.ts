import { helmetOptions } from './setup';

describe('helmetOptions', () => {
  it('sends a locked-down API CSP in production', () => {
    const opts = helmetOptions({ nodeEnv: 'production' });
    expect(opts.contentSecurityPolicy).toMatchObject({ directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } });
  });
  it('turns the CSP off in development so Swagger UI works', () => {
    expect(helmetOptions({ nodeEnv: 'development' }).contentSecurityPolicy).toBe(false);
  });
  it('always sets HSTS for a year and a no-referrer policy', () => {
    const opts = helmetOptions({ nodeEnv: 'test' });
    expect(opts.strictTransportSecurity).toMatchObject({ maxAge: 31_536_000, includeSubDomains: true });
    expect(opts.referrerPolicy).toEqual({ policy: 'no-referrer' });
  });
});
