import { TtlMap } from './cache.js';
export function createRateLimiter(opts = {}) {
    const windowMs = opts.windowMs ?? 60_000;
    const max = opts.max ?? 60;
    const getIp = opts.getIp ?? defaultGetIp;
    const buckets = new TtlMap({
        ttlMs: windowMs,
        maxSize: opts.maxBuckets ?? 50_000,
        sweepIntervalMs: 120_000,
    });
    return function check(req, res) {
        const ip = getIp(req);
        const now = Date.now();
        let bucket = buckets.get(ip);
        if (!bucket || bucket.resetAt < now) {
            bucket = { count: 1, resetAt: now + windowMs };
            buckets.set(ip, bucket);
            res.setHeader('X-RateLimit-Limit', String(max));
            res.setHeader('X-RateLimit-Remaining', String(max - 1));
            res.setHeader('X-RateLimit-Reset', String(Math.floor(bucket.resetAt / 1000)));
            return true;
        }
        if (bucket.count >= max) {
            const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
            res.writeHead(429, {
                'Content-Type': 'application/json',
                'Retry-After': String(retryAfter),
                'X-RateLimit-Limit': String(max),
                'X-RateLimit-Remaining': '0',
                'X-RateLimit-Reset': String(Math.floor(bucket.resetAt / 1000)),
            });
            res.end(JSON.stringify({
                error: 'rate_limit_exceeded',
                message: `Too many requests. Retry after ${retryAfter}s. Higher limits at https://mcp.example.com`,
                retry_after_seconds: retryAfter,
                upgrade_url: 'https://mcp.example.com',
            }));
            return false;
        }
        bucket.count++;
        res.setHeader('X-RateLimit-Limit', String(max));
        res.setHeader('X-RateLimit-Remaining', String(max - bucket.count));
        res.setHeader('X-RateLimit-Reset', String(Math.floor(bucket.resetAt / 1000)));
        return true;
    };
}
/**
 * Extract client IP, preferring Cloudflare/Apache proxy headers.
 * Checks (in order): CF-Connecting-IP, X-Forwarded-For, X-Real-IP, socket.
 */
function defaultGetIp(req) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.length > 0)
        return cf;
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
        const first = xff.split(',')[0]?.trim();
        if (first)
            return first;
    }
    const xr = req.headers['x-real-ip'];
    if (typeof xr === 'string' && xr.length > 0)
        return xr;
    return req.socket.remoteAddress ?? 'unknown';
}
/**
 * Body size limit — reject requests larger than `maxBytes`.
 * MCP requests are small (<10 KB), default 100 KB is generous.
 */
export function checkBodySize(req, res, maxBytes = 100_000) {
    const len = req.headers['content-length'];
    if (typeof len === 'string') {
        const n = Number(len);
        if (!isNaN(n) && n > maxBytes) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'payload_too_large', max_bytes: maxBytes }));
            return false;
        }
    }
    return true;
}
//# sourceMappingURL=rateLimit.js.map