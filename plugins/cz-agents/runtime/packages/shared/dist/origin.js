const DEFAULT_ALLOWED = [
    'https://claude.ai',
    'https://claude.com',
    'https://www.claude.com',
    'https://anthropic.com',
    'https://www.anthropic.com',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    // null Origin (typical for Electron/Claude Desktop without explicit origin)
    'null',
];
const DEFAULT_ALLOWED_PATTERNS = [
    /^app:\/\/.*$/, // Claude Desktop / Electron
    /^chrome-extension:\/\/.*$/, // browser-extension MCP clients
    /^https:\/\/[^/]+\.claude\.ai$/, // claude.ai subdomains
    /^https:\/\/[^/]+\.claude\.com$/, // claude.com subdomains
    /^https:\/\/[^/]+\.anthropic\.com$/, // anthropic.com subdomains
];
let cachedAllowed = null;
function allowedSet() {
    if (cachedAllowed)
        return cachedAllowed;
    const env = process.env.ALLOWED_ORIGINS;
    const list = env !== undefined
        ? env.split(',').map((s) => s.trim()).filter(Boolean)
        : DEFAULT_ALLOWED;
    cachedAllowed = new Set(list);
    return cachedAllowed;
}
/**
 * Validates the Origin header. Returns true to continue request, false
 * if the response was already finalized (403). Missing Origin = allowed
 * (server-to-server / stdio tunnel cases). Rejected origins are logged
 * to stderr for diagnostics.
 */
export function checkOrigin(req, res) {
    const raw = req.headers.origin;
    const origin = Array.isArray(raw) ? raw[0] : raw;
    if (!origin)
        return true;
    const allowed = allowedSet();
    if (allowed.has(origin))
        return true;
    // An operator override is exclusive, including an explicitly empty list.
    // Origin validation is not authentication: non-browser requests still need
    // independent access control at the HTTP boundary.
    if (process.env.ALLOWED_ORIGINS === undefined &&
        DEFAULT_ALLOWED_PATTERNS.some((re) => re.test(origin)))
        return true;
    console.error(`[origin] rejected origin=${JSON.stringify(origin)} ua=${JSON.stringify(req.headers['user-agent'] ?? '')}`);
    if (!res.headersSent) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('X-Origin-Rejected', origin);
        res.end(JSON.stringify({
            error: 'origin_not_allowed',
            origin,
            hint: 'Set ALLOWED_ORIGINS env var on the server to allow your origin, or contact the operator.',
        }));
    }
    return false;
}
/** For tests: reset memoized allowlist after env mutation. */
export function _resetOriginAllowlistCache() {
    cachedAllowed = null;
}
//# sourceMappingURL=origin.js.map