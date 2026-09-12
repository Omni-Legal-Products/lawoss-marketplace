import { createTtlCache } from "./ttl-cache.js";
const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ENTRIES = 500;
const caches = new Map();
function bucketName(provider, kind) {
    return `${provider}::${kind}`;
}
/**
 * Returns a per-process TTL cache scoped to a specific provider + payload kind
 * (e.g. "detail", "text"). Caches are created lazily on first access.
 *
 * Identity is shared across MCP sessions because the factory recreates the
 * application server per session, while we want the hot decision-detail
 * lookups to stay warm for the lifetime of the Node process.
 */
export function getDecisionCache(provider, kind) {
    const key = bucketName(provider, kind);
    const existing = caches.get(key);
    if (existing)
        return existing;
    const created = createTtlCache({
        ttlMs: DEFAULT_TTL_MS,
        maxEntries: DEFAULT_MAX_ENTRIES
    });
    caches.set(key, created);
    return created;
}
/** Test-only: wipe every cache bucket so unit tests are isolated. */
export function __clearAllDecisionCachesForTests() {
    for (const cache of caches.values()) {
        cache.clear();
    }
    caches.clear();
}
//# sourceMappingURL=decision-detail-cache.js.map