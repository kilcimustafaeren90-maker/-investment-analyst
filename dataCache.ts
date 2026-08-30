interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-memory cache keyed by string. Swap for Redis (REDIS_URL is already in
 * .env.example) by replacing this module's internals — callers only use
 * get/set/invalidate, so nothing else in the app needs to change.
 */
class TTLCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }
}

export const cache = new TTLCache();

// Per-data-type cache policies, per the spec:
// financial statements cache until a new filing is detected (long TTL +
// explicit invalidation on new-filing detection, not just time-based);
// company profile daily; price/FX per provider rate limits; news short.
export const CACHE_TTL_MS = {
  FINANCIAL_STATEMENT: 24 * 60 * 60 * 1000, // baseline; invalidate explicitly when a new filing is detected
  COMPANY_PROFILE: 24 * 60 * 60 * 1000,
  PRICE: 60 * 1000,
  FX_RATE: 5 * 60 * 1000,
  NEWS: 2 * 60 * 1000,
  COMPANY_REGISTRY: 24 * 60 * 60 * 1000,
} as const;

export async function withCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = cache.get<T>(key);
  if (cached !== null) return cached;
  const value = await fetcher();
  cache.set(key, value, ttlMs);
  return value;
}
