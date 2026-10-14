import { ConnectionCounter, RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('allows up to the limit then blocks with a retry delay', () => {
    let now = 1_000;
    const rl = new RateLimiter(() => now);
    expect(rl.hit('k', 2, 60_000)).toEqual({ allowed: true, retryAfterSec: 0 });
    expect(rl.hit('k', 2, 60_000).allowed).toBe(true);
    const blocked = rl.hit('k', 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
    now += 30_000;
    expect(rl.hit('k', 2, 60_000).retryAfterSec).toBe(30);
  });

  it('starts a fresh window after it expires', () => {
    let now = 0;
    const rl = new RateLimiter(() => now);
    rl.hit('k', 1, 1_000);
    expect(rl.hit('k', 1, 1_000).allowed).toBe(false);
    now = 1_001;
    expect(rl.hit('k', 1, 1_000).allowed).toBe(true);
  });

  it('keeps keys independent', () => {
    const rl = new RateLimiter(() => 0);
    rl.hit('a', 1, 1_000);
    expect(rl.hit('a', 1, 1_000).allowed).toBe(false);
    expect(rl.hit('b', 1, 1_000).allowed).toBe(true);
  });

  it('forgets expired keys so memory does not grow without bound', () => {
    let now = 0;
    const rl = new RateLimiter(() => now);
    for (let i = 0; i < 5; i++) rl.hit(`k${i}`, 1, 1_000);
    now = 10_000;
    rl.sweep();
    expect(rl.size).toBe(0);
  });
});

describe('ConnectionCounter', () => {
  it('caps concurrent connections per key and frees a slot on release', () => {
    const cc = new ConnectionCounter();
    const a = cc.acquire('ip', 2);
    const b = cc.acquire('ip', 2);
    expect(a && b).toBeTruthy();
    expect(cc.acquire('ip', 2)).toBeNull();
    a?.();
    expect(cc.acquire('ip', 2)).not.toBeNull();
  });

  it('release is idempotent', () => {
    const cc = new ConnectionCounter();
    const a = cc.acquire('ip', 1);
    a?.();
    a?.();
    expect(cc.acquire('ip', 1)).not.toBeNull();
    expect(cc.acquire('ip', 1)).toBeNull();
  });
});
