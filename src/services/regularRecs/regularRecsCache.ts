//
//  regularRecsCache.ts
//  Self-contained in-memory TTL cache for the REGULAR recommendation engine.
//  (No Redis / external service.)
//

interface RegularCacheEntry<T> {
  value: T;
  expires: number;
}

class RegularTtlCache {
  private store = new Map<string, RegularCacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expires: Date.now() + ttlMs });
  }
}

export const regularRecsCache = new RegularTtlCache();
