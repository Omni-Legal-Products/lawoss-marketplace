import { validateIcoInput } from './ico.js';
import { createRateLimiter } from './rateLimit.js';
export function parseIco(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const candidate = url.pathname.split('/').find((part) => /^\d{7,8}$/.test(part)) ?? url.searchParams.get('ico');
    try {
        return validateIcoInput(candidate);
    }
    catch (e) {
        jsonErr(res, 400, 'invalid_ico', e instanceof Error ? e.message : 'Invalid IČO');
        return null;
    }
}
export function jsonOk(res, data, source = 'unknown') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        data,
        meta: {
            fetched_at: new Date().toISOString(),
            source,
        },
    }));
}
export function jsonErr(res, status, code, detail) {
    res.writeHead(status, { 'Content-Type': 'application/problem+json' });
    res.end(JSON.stringify({
        type: `https://mcp.example.com`,
        title: code,
        status,
        detail,
    }));
}
export function getRestIp(req) {
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
export function createRestRateLimiter(opts = {}) {
    return createRateLimiter({
        windowMs: opts.windowMs ?? 60 * 60 * 1000,
        max: opts.max ?? 300,
        getIp: opts.getIp ?? getRestIp,
    });
}
//# sourceMappingURL=rest.js.map