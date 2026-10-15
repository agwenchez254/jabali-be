import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Request signing. Each of our frontends signs the requests it sends with a shared secret, so the API can reject
 * calls that were not made by our own apps, were altered on the way, or are replays of a captured request.
 *
 * What it is and is not: the secret ships inside the browser app, so anyone willing to dig it out can sign requests
 * too. This stops casual scripts, scrapers, tampering and replays. It does not replace login tokens, rate limits or
 * CORS, which stay in force, and it must never be the only thing protecting an endpoint.
 *
 * The algorithm is fixed (HMAC-SHA256). The `X-Signature-Alg` header is only checked for an exact match and is never
 * used to pick an algorithm, so a caller cannot downgrade it (the "alg: none" class of bug).
 */

export const SIGNING_ALG = 'HMAC-SHA256';
export const SIGNING_VERSION = 'JABALI-SIGN-V1';
export const MAX_SKEW_MS = 120_000;
export const NONCE_TTL_MS = 300_000;
/** Sent instead of a body hash for multipart uploads, whose bytes the browser does not expose before sending. */
export const UNSIGNED_BODY = 'UNSIGNED-MULTIPART';

const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const HEX64_RE = /^[a-f0-9]{64}$/;

export interface SigningHeaders {
  clientId?: string;
  timestamp?: string;
  nonce?: string;
  contentSha256?: string;
  signature?: string;
  alg?: string;
}

export interface VerifyInput {
  method: string;
  /** Path and query exactly as received, e.g. `/api/v1/store/orders?x=1`. */
  url: string;
  headers: SigningHeaders;
  /** The raw request body bytes. Empty buffer for no body. */
  body: Buffer;
  isMultipart: boolean;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

export const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

/** The exact text that is signed. Both sides must build it identically. */
export function canonicalString(p: { method: string; url: string; timestamp: string; nonce: string; clientId: string; contentSha256: string }): string {
  return [SIGNING_VERSION, p.method.toUpperCase(), p.url, p.timestamp, p.nonce, p.clientId, p.contentSha256].join('\n');
}

export function sign(key: string, p: Parameters<typeof canonicalString>[0]): string {
  return createHmac('sha256', key).update(canonicalString(p)).digest('base64url');
}

/** Remembers recent nonces so a captured request cannot be sent again. In memory: one process. */
export class NonceStore {
  private readonly seen = new Map<string, number>();
  constructor(private readonly ttlMs = NONCE_TTL_MS, private readonly maxSize = 200_000) {}

  /** True when the nonce is new (and is now remembered); false when it was already used. */
  use(clientId: string, nonce: string, now: number): boolean {
    this.sweep(now);
    const key = `${clientId}:${nonce}`;
    if (this.seen.has(key)) return false;
    // Under flood, refuse new nonces rather than forget old ones: an attacker could otherwise evict entries to replay.
    if (this.seen.size >= this.maxSize) return false;
    this.seen.set(key, now + this.ttlMs);
    return true;
  }

  private sweep(now: number): void {
    if (this.seen.size === 0) return;
    for (const [k, expires] of this.seen) {
      if (expires > now) break; // entries are inserted in time order, so the rest are newer
      this.seen.delete(k);
    }
  }

  get size(): number {
    return this.seen.size;
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Checks one request. `keys` maps client id to secret. Failure reasons are for the log, never for the response body. */
export function verifyRequest(input: VerifyInput, keys: ReadonlyMap<string, string>, nonces: NonceStore, now = Date.now()): Verdict {
  const h = input.headers;
  if (h.alg !== SIGNING_ALG) return { ok: false, reason: 'bad_alg' };
  if (!h.clientId || !h.timestamp || !h.nonce || !h.contentSha256 || !h.signature) return { ok: false, reason: 'missing_header' };
  const key = keys.get(h.clientId);
  if (!key) return { ok: false, reason: 'unknown_client' };
  if (!NONCE_RE.test(h.nonce)) return { ok: false, reason: 'bad_nonce' };

  const ts = Number(h.timestamp);
  if (!Number.isInteger(ts) || Math.abs(now - ts) > MAX_SKEW_MS) return { ok: false, reason: 'stale_timestamp' };

  if (input.isMultipart) {
    if (h.contentSha256 !== UNSIGNED_BODY) return { ok: false, reason: 'bad_digest' };
  } else {
    if (!HEX64_RE.test(h.contentSha256) || !safeEqual(h.contentSha256, sha256Hex(input.body))) return { ok: false, reason: 'body_mismatch' };
  }

  const expected = sign(key, { method: input.method, url: input.url, timestamp: h.timestamp, nonce: h.nonce, clientId: h.clientId, contentSha256: h.contentSha256 });
  if (!safeEqual(expected, h.signature)) return { ok: false, reason: 'bad_signature' };

  // Only a correctly signed request may consume a nonce, so junk cannot fill the store.
  if (!nonces.use(h.clientId, h.nonce, now)) return { ok: false, reason: 'replayed' };
  return { ok: true };
}

/** Which requests must be signed. Public read-only catalogue calls stay unsigned so they remain cacheable. */
export function requiresSignature(method: string, url: string): boolean {
  const path = (url.split('?')[0] ?? '').replace(/^\/api\/v1/, '').replace(/\/+$/, '') || '/';
  if (method === 'OPTIONS') return false;
  // Called by Safaricom (authenticated by its own secret path), static files, health checks, docs, and the public
  // SSE stream (EventSource cannot set headers).
  if (/^\/(webhooks|health)(\/|$)/.test(path) || /^\/store\/events$/.test(path)) return false;
  if (/^\/api\/docs/.test(url) || url.startsWith('/uploads/')) return false;
  if (method !== 'GET' && method !== 'HEAD') return true;
  // Reads that return personal or staff data.
  return /^\/(admin|store\/me|store\/orders|store\/payments)(\/|$)/.test(path);
}

export interface SigningConfig {
  enabled: boolean;
  keys: Map<string, string>;
}

const DEV_KEYS = new Map([
  ['storefront', 'dev-only-storefront-signing-key-not-a-secret'],
  ['dashboard', 'dev-only-dashboard-signing-key-not-a-secret'],
]);

/** REQUEST_SIGNING=on|off (default on, off under test) and REQUEST_SIGNING_KEYS="storefront:<key>,dashboard:<key>". */
export function loadSigningConfig(env: NodeJS.ProcessEnv): SigningConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const mode = env.REQUEST_SIGNING ?? (nodeEnv === 'test' ? 'off' : 'on');
  if (mode === 'off') {
    if (nodeEnv === 'production') throw new Error('REQUEST_SIGNING=off is not allowed in production');
    return { enabled: false, keys: new Map() };
  }
  const keys = new Map<string, string>();
  for (const part of (env.REQUEST_SIGNING_KEYS ?? '').split(',')) {
    const i = part.indexOf(':');
    if (i < 1) continue;
    keys.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  if (nodeEnv === 'production') {
    if (keys.size === 0) throw new Error('REQUEST_SIGNING_KEYS is required in production');
    for (const [id, k] of keys) if (k.length < 32) throw new Error(`REQUEST_SIGNING_KEYS: the key for "${id}" must be at least 32 characters`);
  }
  return { enabled: true, keys: keys.size ? keys : DEV_KEYS };
}
