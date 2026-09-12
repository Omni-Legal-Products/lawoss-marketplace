import crypto from "node:crypto";
const networkKey = crypto.randomBytes(32);
export const networkRateLimitKey = (identity) => "network:" + crypto.createHmac("sha256", networkKey).update(identity).digest("base64url");
export const clientRateLimitKey = (clientId) => "client:" + crypto.createHmac("sha256", networkKey).update(clientId).digest("base64url");
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
/** Bounded fixed-window limiter: burst is the literal allowance for the computed window. */
export function createRateLimiter(options) {
    const maxKeys = options.maxKeys ?? 10_000;
    const inactivityMs = options.inactivityMs ?? 10 * 60_000;
    const now = options.now ?? (() => Date.now());
    const buckets = new Map();
    if (!Number.isSafeInteger(maxKeys) || maxKeys < 1)
        throw new Error("Rate limiter maxKeys is invalid.");
    const profile = (name) => name && options.limits?.[name] ? options.limits[name] : options;
    const windowMs = (selected) => Math.max(1, Math.ceil((selected.burst / selected.ratePerMinute) * 60_000));
    function makeRoom(currentMs) {
        if (buckets.size < maxKeys)
            return;
        const expired = [...buckets.entries()]
            .filter(([, bucket]) => currentMs - bucket.lastSeenMs >= inactivityMs)
            .sort(([leftKey, left], [rightKey, right]) => left.lastSeenMs - right.lastSeenMs || leftKey.localeCompare(rightKey));
        for (const [key] of expired) {
            buckets.delete(key);
            if (buckets.size < maxKeys)
                return;
        }
        const victim = [...buckets.entries()]
            .sort(([leftKey, left], [rightKey, right]) => left.lastSeenMs - right.lastSeenMs || leftKey.localeCompare(rightKey))[0]?.[0];
        if (victim)
            buckets.delete(victim);
    }
    return {
        check(key, limit) {
            const selected = profile(limit);
            if (!(selected.ratePerMinute > 0) || !Number.isSafeInteger(selected.burst) || selected.burst < 1)
                throw new Error("Rate limiter profile is invalid.");
            const currentMs = now();
            let bucket = buckets.get(key);
            if (!bucket) {
                makeRoom(currentMs);
                bucket = { counters: new Map(), lastSeenMs: currentMs };
                buckets.set(key, bucket);
            }
            bucket.lastSeenMs = currentMs;
            const counterKey = limit ?? "default";
            let counter = bucket.counters.get(counterKey);
            const duration = windowMs(selected);
            if (!counter || currentMs - counter.windowStartedMs >= duration) {
                counter = { attempts: 0, windowStartedMs: currentMs };
                bucket.counters.set(counterKey, counter);
            }
            if (counter.attempts < selected.burst) {
                counter.attempts += 1;
                return { allowed: true };
            }
            return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((counter.windowStartedMs + duration - currentMs) / 1000)) };
        },
        size: () => buckets.size,
    };
}
