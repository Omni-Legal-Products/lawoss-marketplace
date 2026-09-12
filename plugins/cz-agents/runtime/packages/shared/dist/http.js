/**
 * Minimal typed HTTP client with retries + User-Agent branding.
 * Used by each MCP server to fetch data from Czech gov APIs.
 */
export class HttpError extends Error {
    status;
    url;
    body;
    constructor(status, url, body) {
        super(`HTTP ${status} from ${url}`);
        this.status = status;
        this.url = url;
        this.body = body;
        this.name = 'HttpError';
    }
}
export class HttpClient {
    baseUrl;
    userAgent;
    timeoutMs;
    retries;
    retryDelayMs;
    constructor(opts) {
        this.baseUrl = opts.baseUrl.replace(/\/$/, '');
        this.userAgent = opts.userAgent ?? 'cz-agents-mcp/0.1 (+https://mcp.example.com)';
        this.timeoutMs = opts.timeoutMs ?? 15_000;
        this.retries = opts.retries ?? 2;
        this.retryDelayMs = opts.retryDelayMs ?? 500;
    }
    async getJson(path, init = {}) {
        const text = await this.getText(path, init);
        return JSON.parse(text);
    }
    async getText(path, init = {}) {
        const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
        let lastErr;
        for (let attempt = 0; attempt <= this.retries; attempt++) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
            try {
                const resp = await fetch(url, {
                    ...init,
                    signal: ctrl.signal,
                    headers: {
                        'Accept': 'application/json, text/xml, */*',
                        'User-Agent': this.userAgent,
                        ...init.headers,
                    },
                });
                clearTimeout(timer);
                if (!resp.ok) {
                    const body = await resp.text().catch(() => undefined);
                    // Don't retry 4xx (client errors)
                    if (resp.status >= 400 && resp.status < 500) {
                        throw new HttpError(resp.status, url, body);
                    }
                    throw new HttpError(resp.status, url, body);
                }
                return await resp.text();
            }
            catch (err) {
                clearTimeout(timer);
                lastErr = err;
                if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
                    throw err; // Don't retry client errors
                }
                if (attempt < this.retries) {
                    await new Promise((r) => setTimeout(r, this.retryDelayMs * (attempt + 1)));
                }
            }
        }
        throw lastErr;
    }
}
//# sourceMappingURL=http.js.map