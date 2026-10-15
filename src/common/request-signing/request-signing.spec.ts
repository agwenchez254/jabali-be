import {
  NonceStore,
  SIGNING_ALG,
  UNSIGNED_BODY,
  loadSigningConfig,
  requiresSignature,
  sha256Hex,
  sign,
  verifyRequest,
  type SigningHeaders,
} from './request-signing';

const KEY = 'k'.repeat(40);
const keys = new Map([['storefront', KEY]]);
const NOW = 1_800_000_000_000;

function signed(over: Partial<SigningHeaders> = {}, body = '{"a":1}', url = '/api/v1/store/orders', method = 'POST') {
  const contentSha256 = sha256Hex(body);
  const base = { method, url, timestamp: String(NOW), nonce: 'AbCdEfGhIjKlMnOp12', clientId: 'storefront', contentSha256 };
  const headers: SigningHeaders = { ...base, signature: sign(KEY, base), alg: SIGNING_ALG, ...over };
  return { method, url, headers, body: Buffer.from(body), isMultipart: false };
}

describe('verifyRequest', () => {
  it('accepts a correctly signed request', () => {
    expect(verifyRequest(signed(), keys, new NonceStore(), NOW)).toEqual({ ok: true });
  });

  it('rejects a replay of the same request', () => {
    const nonces = new NonceStore();
    expect(verifyRequest(signed(), keys, nonces, NOW).ok).toBe(true);
    expect(verifyRequest(signed(), keys, nonces, NOW + 1000)).toEqual({ ok: false, reason: 'replayed' });
  });

  it('rejects a changed body, path or method', () => {
    const r = signed();
    expect(verifyRequest({ ...r, body: Buffer.from('{"a":2}') }, keys, new NonceStore(), NOW)).toEqual({ ok: false, reason: 'body_mismatch' });
    expect(verifyRequest({ ...r, url: '/api/v1/store/other' }, keys, new NonceStore(), NOW)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyRequest({ ...r, method: 'PUT' }, keys, new NonceStore(), NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects stale and future timestamps', () => {
    const old = signed({ timestamp: String(NOW - 130_000) });
    const early = signed({ timestamp: String(NOW + 130_000) });
    expect(verifyRequest(old, keys, new NonceStore(), NOW)).toEqual({ ok: false, reason: 'stale_timestamp' });
    expect(verifyRequest(early, keys, new NonceStore(), NOW)).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('ignores the algorithm a caller names: anything but the pinned one is refused', () => {
    for (const alg of ['none', 'HMAC-MD5', 'hmac-sha256', undefined]) {
      expect(verifyRequest(signed({ alg }), keys, new NonceStore(), NOW)).toEqual({ ok: false, reason: 'bad_alg' });
    }
  });

  it('rejects unknown clients, wrong keys and missing headers', () => {
    expect(verifyRequest(signed({ clientId: 'other' }), keys, new NonceStore(), NOW).ok).toBe(false);
    expect(verifyRequest(signed({ signature: 'x'.repeat(43) }), keys, new NonceStore(), NOW)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyRequest(signed({ signature: undefined }), keys, new NonceStore(), NOW)).toEqual({ ok: false, reason: 'missing_header' });
  });

  it('does not let an invalid request use up a nonce', () => {
    const nonces = new NonceStore();
    verifyRequest(signed({ signature: 'x'.repeat(43) }), keys, nonces, NOW);
    expect(nonces.size).toBe(0);
  });

  it('accepts multipart only with the unsigned-body marker', () => {
    const base = { method: 'POST', url: '/api/v1/admin/media', timestamp: String(NOW), nonce: 'ZzZzZzZzZzZzZzZz99', clientId: 'storefront', contentSha256: UNSIGNED_BODY };
    const r = { method: 'POST', url: base.url, headers: { ...base, signature: sign(KEY, base), alg: SIGNING_ALG }, body: Buffer.from('binary'), isMultipart: true };
    expect(verifyRequest(r, keys, new NonceStore(), NOW).ok).toBe(true);
    const json = { ...r, isMultipart: false };
    expect(verifyRequest(json, keys, new NonceStore(), NOW)).toEqual({ ok: false, reason: 'body_mismatch' });
  });
});

describe('NonceStore', () => {
  it('forgets nonces after the window and refuses new ones when full', () => {
    const s = new NonceStore(1000, 2);
    expect(s.use('c', 'n1', 0)).toBe(true);
    expect(s.use('c', 'n1', 500)).toBe(false);
    expect(s.use('c', 'n1', 1500)).toBe(true);
    expect(s.use('c', 'n2', 1600)).toBe(true);
    expect(s.use('c', 'n3', 1700)).toBe(false);
  });
});

describe('requiresSignature', () => {
  it('requires it for every mutation except webhooks', () => {
    expect(requiresSignature('POST', '/api/v1/store/orders')).toBe(true);
    expect(requiresSignature('PATCH', '/api/v1/admin/customers/1')).toBe(true);
    expect(requiresSignature('DELETE', '/api/v1/store/me/addresses/1')).toBe(true);
    expect(requiresSignature('POST', '/api/v1/webhooks/mpesa/secret')).toBe(false);
  });

  it('requires it for personal and staff reads, not for the public catalogue', () => {
    expect(requiresSignature('GET', '/api/v1/admin/orders?page=1')).toBe(true);
    expect(requiresSignature('GET', '/api/v1/store/me')).toBe(true);
    expect(requiresSignature('GET', '/api/v1/store/orders/JB-000001?phone=0712')).toBe(true);
    expect(requiresSignature('GET', '/api/v1/store/products')).toBe(false);
    expect(requiresSignature('GET', '/api/v1/store/events')).toBe(false);
    expect(requiresSignature('GET', '/api/v1/health')).toBe(false);
    expect(requiresSignature('OPTIONS', '/api/v1/store/orders')).toBe(false);
  });
});

describe('loadSigningConfig', () => {
  it('is off under test, on otherwise, and falls back to dev keys outside production', () => {
    expect(loadSigningConfig({ NODE_ENV: 'test' }).enabled).toBe(false);
    const dev = loadSigningConfig({ NODE_ENV: 'development' });
    expect(dev.enabled).toBe(true);
    expect([...dev.keys.keys()].sort()).toEqual(['dashboard', 'storefront']);
  });

  it('insists on strong keys in production and refuses to be switched off there', () => {
    expect(() => loadSigningConfig({ NODE_ENV: 'production' })).toThrow(/REQUEST_SIGNING_KEYS/);
    expect(() => loadSigningConfig({ NODE_ENV: 'production', REQUEST_SIGNING_KEYS: 'storefront:short' })).toThrow(/32/);
    expect(() => loadSigningConfig({ NODE_ENV: 'production', REQUEST_SIGNING: 'off' })).toThrow(/not allowed/);
    const ok = loadSigningConfig({ NODE_ENV: 'production', REQUEST_SIGNING_KEYS: `storefront:${'a'.repeat(32)},dashboard:${'b'.repeat(32)}` });
    expect(ok.keys.get('dashboard')).toBe('b'.repeat(32));
  });
});
