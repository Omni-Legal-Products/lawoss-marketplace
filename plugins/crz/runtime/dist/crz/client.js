import { setTimeout as delay } from "node:timers/promises";
const RATE_LIMIT_PER_MIN = parseInt(process.env.CRZ_RATE_LIMIT_PER_MIN ?? "60", 10);
const USER_AGENT = process.env.CRZ_USER_AGENT ?? "CRZ-MCP/1.0 (+https://github.com/Omni-Legal-Products/mcp-crz)";
const REQUEST_TIMEOUT_MS = parseInt(process.env.CRZ_REQUEST_TIMEOUT_MS ?? "20000", 10);
const MAX_RETRIES = parseInt(process.env.CRZ_MAX_RETRIES ?? "3", 10);
const buckets = new Map();
function hostKey(url) {
    try {
        return new URL(url).host;
    }
    catch {
        return "_unknown_";
    }
}
async function consumeToken(url) {
    if (RATE_LIMIT_PER_MIN <= 0)
        return;
    const host = hostKey(url);
    const capacity = RATE_LIMIT_PER_MIN;
    const refillPerMs = capacity / 60_000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const now = Date.now();
        let b = buckets.get(host);
        if (!b) {
            b = { tokens: capacity, last: now };
            buckets.set(host, b);
        }
        const elapsed = now - b.last;
        b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
        b.last = now;
        if (b.tokens >= 1) {
            b.tokens -= 1;
            return;
        }
        const waitMs = Math.ceil((1 - b.tokens) / refillPerMs);
        await delay(Math.max(50, waitMs));
    }
}
export async function httpGet(url, opts = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        await consumeToken(url);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const signal = opts.signal
            ? mergeSignals(opts.signal, controller.signal)
            : controller.signal;
        try {
            const res = await fetch(url, {
                method: "GET",
                redirect: "follow",
                headers: {
                    "User-Agent": USER_AGENT,
                    "Accept": opts.acceptBinary ? "*/*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "sk,sk-SK;q=0.9,en;q=0.5",
                    "Accept-Encoding": "gzip, deflate, br",
                    ...(opts.headers ?? {}),
                },
                signal,
            });
            clearTimeout(timer);
            if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
                if (attempt < MAX_RETRIES) {
                    await delay(backoffMs(attempt, res));
                    continue;
                }
            }
            const buf = await readBoundedBody(res, opts.maxBytes);
            return {
                status: res.status,
                url: res.url,
                headers: res.headers,
                body: buf,
                text: () => new TextDecoder("utf-8").decode(buf),
                json: () => JSON.parse(new TextDecoder("utf-8").decode(buf)),
            };
        }
        catch (err) {
            clearTimeout(timer);
            lastErr = err;
            if (attempt < MAX_RETRIES) {
                await delay(backoffMs(attempt));
                continue;
            }
            throw err;
        }
    }
    throw lastErr ?? new Error("CRZ httpGet exhausted retries");
}
async function readBoundedBody(res, maxBytes) {
    if (!maxBytes)
        return await res.arrayBuffer();
    const reader = res.body?.getReader();
    if (!reader)
        return new ArrayBuffer(0);
    const chunks = [];
    let total = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const { value, done } = await reader.read();
        if (done)
            break;
        if (!value)
            continue;
        total += value.byteLength;
        if (total > maxBytes) {
            try {
                await reader.cancel();
            }
            catch { /* noop */ }
            throw new Error(`Response exceeded maxBytes=${maxBytes} (got ${total})`);
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
    }
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}
function backoffMs(attempt, res) {
    const retryAfter = res?.headers.get("retry-after");
    if (retryAfter) {
        const asInt = parseInt(retryAfter, 10);
        if (!Number.isNaN(asInt))
            return asInt * 1000;
    }
    const base = 500 * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 250);
    return base + jitter;
}
function mergeSignals(a, b) {
    if (a.aborted)
        return a;
    if (b.aborted)
        return b;
    const ctrl = new AbortController();
    const onAbortA = () => ctrl.abort(a.reason);
    const onAbortB = () => ctrl.abort(b.reason);
    a.addEventListener("abort", onAbortA, { once: true });
    b.addEventListener("abort", onAbortB, { once: true });
    return ctrl.signal;
}
export const CRZ_BASE_URL = "https://www.crz.gov.sk";
//# sourceMappingURL=client.js.map