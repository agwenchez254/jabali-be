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
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://a.example.com' })).not.toThrow();
  });
});
