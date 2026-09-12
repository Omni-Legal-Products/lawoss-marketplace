/**
 * Tiny in-memory LRU-ish TTL cache — protects upstream APIs (ARES) from
 * getting hammered with repeated identical queries.
 *
 * Not distributed — per-process. For multi-replica deploy, swap for Redis.
 */
/**
 * Process-local Map with a hard entry cap and active expiry. Reads refresh LRU
 * position but not TTL, so frequently-read stale data still expires.
 */
export class TtlMap {
    map = new Map();
    ttlMs;
    maxSize;
    onEvict;
    sweeping = false;
    constructor(opts) {
        this.ttlMs = opts.ttlMs;
        this.maxSize = opts.maxSize;
        this.onEvict = opts.onEvict;
        const sweepIntervalMs = opts.sweepIntervalMs ?? Math.min(this.ttlMs, 60_000);
        if (sweepIntervalMs !== false) {
            const timer = setInterval(() => this.sweep(), sweepIntervalMs);
            timer.unref();
        }
    }
    get(key) {
        const entry = this.map.get(key);
        if (!entry)
            return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.evict(key, entry);
            return undefined;
        }
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }
    has(key) {
        return this.get(key) !== undefined;
    }
    set(key, value, ttlMs = this.ttlMs) {
        this.sweep();
        this.map.delete(key);
        while (this.map.size >= this.maxSize) {
            const oldest = this.map.entries().next();
            if (oldest.done)
                break;
            const sizeBeforeEviction = this.map.size;
            this.evict(oldest.value[0], oldest.value[1]);
            if (this.map.size >= sizeBeforeEviction)
                break;
        }
        this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
        return this;
    }
    delete(key) {
        return this.map.delete(key);
    }
    clear() {
        this.map.clear();
    }
    sweep() {
        if (this.sweeping)
            return;
        this.sweeping = true;
        try {
            const now = Date.now();
            for (const [key, entry] of this.map) {
                if (entry.expiresAt <= now)
                    this.evict(key, entry);
            }
        }
        finally {
            this.sweeping = false;
        }
    }
    get size() {
        this.sweep();
        return this.map.size;
    }
    *[Symbol.iterator]() {
        this.sweep();
        for (const [key, entry] of this.map) {
            yield [key, entry.value];
        }
    }
    evict(key, entry) {
        if (!this.map.delete(key))
            return;
        this.onEvict?.(key, entry.value);
    }
}
export class TtlCache {
    map;
    constructor(opts) {
        this.map = new TtlMap({ ttlMs: opts.ttlMs, maxSize: opts.maxSize ?? 1000 });
    }
    get(key) {
        return this.map.get(key);
    }
    set(key, value) {
        this.map.set(key, value);
    }
    async memoize(key, loader) {
        const cached = this.get(key);
        if (cached !== undefined)
            return cached;
        const value = await loader();
        this.set(key, value);
        return value;
    }
    clear() {
        this.map.clear();
    }
    get size() {
        return this.map.size;
    }
}
//# sourceMappingURL=cache.js.map