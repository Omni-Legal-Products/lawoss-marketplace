/**
 * Small TTL + LRU cache. Designed for per-process hot caches like decision
 * detail lookups, not for shared cross-process state.
 *
 * Insertion order in the underlying Map doubles as LRU because we re-insert on
 * read (cheap on Map). Expired entries are skipped on access and lazily evicted.
 */
export function createTtlCache(options) {
    const ttlMs = Math.max(0, options.ttlMs);
    const maxEntries = Math.max(1, options.maxEntries);
    const now = options.now ?? (() => Date.now());
    const store = new Map();
    const pending = new Map();
    function evictIfNeeded() {
        while (store.size > maxEntries) {
            const oldest = store.keys().next().value;
            if (typeof oldest !== "string")
                break;
            store.delete(oldest);
        }
    }
    function readEntry(key) {
        const entry = store.get(key);
        if (!entry)
            return undefined;
        if (entry.expiresAtMs <= now()) {
            store.delete(key);
            return undefined;
        }
        // Re-insert to mark as most-recently-used.
        store.delete(key);
        store.set(key, entry);
        return entry.value;
    }
    return {
        get: readEntry,
        set(key, value) {
            const expiresAtMs = ttlMs > 0 ? now() + ttlMs : Number.POSITIVE_INFINITY;
            store.delete(key);
            store.set(key, { value, expiresAtMs });
            evictIfNeeded();
        },
        has(key) {
            return readEntry(key) !== undefined;
        },
        delete(key) {
            return store.delete(key);
        },
        clear() {
            store.clear();
            pending.clear();
        },
        size() {
            return store.size;
        },
        async getOrLoad(key, loader) {
            const cached = readEntry(key);
            if (cached !== undefined)
                return cached;
            const inflight = pending.get(key);
            if (inflight)
                return inflight;
            const promise = (async () => {
                try {
                    const value = await loader();
                    this.set(key, value);
                    return value;
                }
                finally {
                    pending.delete(key);
                }
            })();
            pending.set(key, promise);
            return promise;
        }
    };
}
//# sourceMappingURL=ttl-cache.js.map