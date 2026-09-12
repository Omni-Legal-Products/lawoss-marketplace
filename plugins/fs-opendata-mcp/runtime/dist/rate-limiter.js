import crypto from "node:crypto";
export const networkRateLimitKey = (networkIdentity) => `network:${crypto.createHash("sha256").update(networkIdentity).digest("base64url")}`;
export const clientRateLimitKey = (clientId) => `client:${crypto.createHash("sha256").update(clientId).digest("base64url")}`;
export const STDIO_RATE_LIMIT_KEY = "stdio";
export function createRequestRateLimiter(options = {}) {
    return createRateLimiter({
        ratePerMinute: 6,
        burst: 60,
        maxKeys: options.maxKeys ?? 2_048,
        inactivityMs: options.inactivityMs ?? 10 * 60_000,
        ...(options.now ? { now: options.now } : {}),
        limits: {
            dcr: { ratePerMinute: 2, burst: 20 },
            token: { ratePerMinute: 2, burst: 20 },
            login: { ratePerMinute: 2, burst: 20 },
            mcp: { ratePerMinute: 6, burst: 60 },
        },
    });
}
/**
 * In-memory fixed-window rate limiter. `burst` is the literal attempt ceiling;
 * `ratePerMinute` determines the corresponding window length. For example,
 * 20 attempts at 2/minute is one non-refilling ten-minute window.
 * Designed for a single-process MCP server.
 * If the server is ever horizontally scaled, this needs to move to a shared store.
 */
export function createRateLimiter(options) {
    const maxKeys = options.maxKeys ?? 10_000;
    const inactivityMs = options.inactivityMs ?? 10 * 60_000;
    const now = options.now ?? (() => Date.now());
    const buckets = new Map();
    function profile(limit) {
        return limit && options.limits?.[limit] ? options.limits[limit] : { ratePerMinute: options.ratePerMinute, burst: options.burst };
    }
    function windowMs(selected) {
        const rate = Math.max(Number.EPSILON, selected.ratePerMinute);
        return Math.max(1, Math.ceil((Math.max(1, selected.burst) / rate) * 60_000));
    }
    function evictIfNeeded(currentMs) {
        if (buckets.size < maxKeys)
            return;
        for (const [key, bucket] of buckets) {
            if (currentMs - bucket.lastSeenMs > inactivityMs) {
                buckets.delete(key);
            }
            if (buckets.size < maxKeys)
                return;
        }
        // Hard cap: drop the least recently seen active identity, not the first insertion.
        let oldestKey;
        let oldestLastSeen = Number.POSITIVE_INFINITY;
        for (const [key, bucket] of buckets) {
            if (bucket.lastSeenMs < oldestLastSeen) {
                oldestKey = key;
                oldestLastSeen = bucket.lastSeenMs;
            }
        }
        if (oldestKey)
            buckets.delete(oldestKey);
    }
    return {
        check(key, limit) {
            const currentMs = now();
            let bucket = buckets.get(key);
            if (!bucket) {
                evictIfNeeded(currentMs);
                bucket = { counters: new Map(), lastSeenMs: currentMs };
                buckets.set(key, bucket);
            }
            bucket.lastSeenMs = currentMs;
            const selected = profile(limit);
            const counterKey = limit ?? "default";
            let counter = bucket.counters.get(counterKey);
            if (!counter) {
                counter = { attempts: 0, windowStartedMs: currentMs };
                bucket.counters.set(counterKey, counter);
            }
            else if (currentMs - counter.windowStartedMs >= windowMs(selected)) {
                counter.attempts = 0;
                counter.windowStartedMs = currentMs;
            }
            if (counter.attempts < Math.max(1, Math.floor(selected.burst))) {
                counter.attempts += 1;
                return { allowed: true };
            }
            const waitMs = counter.windowStartedMs + windowMs(selected) - currentMs;
            const retryAfterSeconds = Math.max(1, Math.ceil(waitMs / 1000));
            return { allowed: false, retryAfterSeconds };
        },
        size: () => buckets.size,
    };
}
