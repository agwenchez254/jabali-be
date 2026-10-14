import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { CacheStore } from '../models';

export const CACHE_STORE = Symbol('CACHE_STORE');

@Injectable()
export class MemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, { value: unknown; expires: number }>();

  async get<T>(key: string): Promise<T | undefined> {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value as T;
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.map.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
  async delByPrefix(prefix: string): Promise<void> {
    for (const k of this.map.keys()) if (k.startsWith(prefix)) this.map.delete(k);
  }
}

@Injectable()
export class CacheService {
  constructor(@Inject(CACHE_STORE) private readonly store: CacheStore) {}

  /** Read-through helper. Values must be JSON-safe (they are shared between requests). */
  async wrap<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const hit = await this.store.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await loader();
    await this.store.set(key, value, ttlSeconds);
    return value;
  }

  invalidate(prefix = 'store:'): Promise<void> {
    return this.store.delByPrefix(prefix);
  }
}

@Global()
@Module({
  providers: [MemoryCacheStore, { provide: CACHE_STORE, useExisting: MemoryCacheStore }, CacheService],
  exports: [CacheService],
})
export class CacheModule {}
