import { LRUCache } from "lru-cache";
import fs from "fs";
import path from "path";
import { CACHE_DIR, CACHE_MAX, TTL_METADATA } from "./constants.js";
// Single shared LRU cache with per-item TTL
const cache = new LRUCache({
    max: CACHE_MAX,
    ttl: TTL_METADATA, // default TTL, overridden per item
});
export function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry)
        return undefined;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return undefined;
    }
    return entry.value;
}
export function cacheSet(key, value, ttlMs) {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs }, { ttl: ttlMs });
}
export function cacheDelete(key) {
    cache.delete(key);
}
export function cacheClear() {
    cache.clear();
}
export function cacheStats() {
    const fill_pct = Math.round((cache.size / CACHE_MAX) * 1000) / 10;
    return { size: cache.size, max_size: CACHE_MAX, fill_pct };
}
// Disk persistence: dump to JSON on shutdown, load on startup
const DUMP_FILE = path.join(CACHE_DIR, "eurlex-cache.json");
export function dumpCacheToDisk() {
    try {
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }
        const entries = [];
        for (const [key, entry] of cache.entries()) {
            // Only dump non-expired entries
            if (Date.now() < entry.expiresAt) {
                entries.push([key, entry]);
            }
        }
        fs.writeFileSync(DUMP_FILE, JSON.stringify(entries), "utf-8");
        console.error(`[cache] Dumped ${entries.length} entries to disk`);
    }
    catch (err) {
        console.error(`[cache] Failed to dump cache: ${err}`);
    }
}
export function loadCacheFromDisk() {
    try {
        if (!fs.existsSync(DUMP_FILE))
            return;
        const raw = fs.readFileSync(DUMP_FILE, "utf-8");
        const entries = JSON.parse(raw);
        let loaded = 0;
        for (const [key, entry] of entries) {
            if (Date.now() < entry.expiresAt) {
                const remainingTtl = entry.expiresAt - Date.now();
                cache.set(key, entry, { ttl: remainingTtl });
                loaded++;
            }
        }
        console.error(`[cache] Loaded ${loaded} entries from disk`);
    }
    catch (err) {
        console.error(`[cache] Failed to load cache from disk: ${err}`);
    }
}
//# sourceMappingURL=cache.js.map