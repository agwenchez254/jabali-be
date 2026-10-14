import { assertCorsOrigins, loadConfig } from './config';

const base = { DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: 'x'.repeat(40) };

describe('assertCorsOrigins', () => {
  it('allows http localhost origins outside production', () => {
    expect(() => assertCorsOrigins(['http://localhost:5173'], 'development')).not.toThrow();
  });
  it('rejects a wildcard in any environment', () => {
    expect(() => assertCorsOrigins(['*'], 'development')).toThrow(/wildcard/i);
  });
  it('requires https origins in production', () => {
    expect(() => assertCorsOrigins(['http://shop.example.com'], 'production')).toThrow(/https/);
    expect(() => assertCorsOrigins(['https://shop.example.com'], 'production')).not.toThrow();
  });
});

describe('loadConfig hardening', () => {
  it('defaults to one trusted proxy hop and rate limiting on', () => {
    const cfg = loadConfig({ ...base });
    expect(cfg.trustProxyHops).toBe(1);
    expect(cfg.rateLimitEnabled).toBe(true);
  });
  it('rejects disabling rate limiting in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://a.example.com', RATE_LIMIT_ENABLED: 'false' })).toThrow(/RATE_LIMIT_ENABLED/);
  });
  it('rejects insecure CORS origins in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'http://a.example.com' })).toThrow(/https/);
  });
  it('accepts a valid production configuration', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://a.example.com', STORE_URL: 'https://shop.example.com', SMTP_URL: 'smtp://mail.example.com:587' }),
    ).not.toThrow();
  });
});

describe('mail config', () => {
  const prod = { ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://a.example.com', STORE_URL: 'https://shop.example.com', SMTP_URL: 'smtp://mail.example.com:587' };

  it('has safe development defaults and no SMTP', () => {
    const cfg = loadConfig({ ...base });
    expect(cfg.mail.smtpUrl).toBeUndefined();
    expect(cfg.mail.from).toBe('Jabali <no-reply@jabali.co.ke>');
    expect(cfg.mail.storeUrl).toBe('http://localhost:5173');
  });
  it('strips a trailing slash from STORE_URL', () => {
    expect(loadConfig({ ...base, STORE_URL: 'https://shop.example.com/' }).mail.storeUrl).toBe('https://shop.example.com');
  });
  it('requires SMTP_URL in production', () => {
    const { SMTP_URL: _omit, ...noSmtp } = prod;
    expect(() => loadConfig(noSmtp)).toThrow(/SMTP_URL is required in production/);
    expect(() => loadConfig(prod)).not.toThrow();
  });
  it('requires an https STORE_URL in production', () => {
    expect(() => loadConfig({ ...prod, STORE_URL: 'http://shop.example.com' })).toThrow(/STORE_URL must use https/);
  });
  it('rejects a malformed SMTP_URL and a MAIL_FROM with line breaks', () => {
    expect(() => loadConfig({ ...base, SMTP_URL: 'http://not-smtp' })).toThrow(/SMTP_URL/);
    expect(() => loadConfig({ ...base, MAIL_FROM: 'Jabali <a@b.co>\r\nBcc: x@y.z' })).toThrow(/MAIL_FROM/);
  });
  it('treats an empty SMTP_URL as unset', () => {
    expect(loadConfig({ ...base, SMTP_URL: '' }).mail.smtpUrl).toBeUndefined();
  });
});
