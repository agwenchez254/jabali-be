/** Fixed-window counter keyed by an arbitrary string. In-process: one API instance only. */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private hits = 0;

  constructor(private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.windows.size;
  }

  hit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
    const t = this.now();
    if (++this.hits % 500 === 0) this.sweep();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    if (w.count <= limit) return { allowed: true, retryAfterSec: 0 };
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - t) / 1000)) };
  }

  /** Drops expired windows. */
  sweep(): void {
    const t = this.now();
    for (const [k, w] of this.windows) if (w.resetAt <= t) this.windows.delete(k);
  }
}

/** Caps concurrent long-lived connections (e.g. SSE) per key. */
export class ConnectionCounter {
  private readonly open = new Map<string, number>();

  /** A release function, or null when `max` connections are already open for the key. */
  acquire(key: string, max: number): (() => void) | null {
    const n = this.open.get(key) ?? 0;
    if (n >= max) return null;
    this.open.set(key, n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.open.get(key) ?? 1) - 1;
      if (left <= 0) this.open.delete(key);
      else this.open.set(key, left);
    };
  }
}
