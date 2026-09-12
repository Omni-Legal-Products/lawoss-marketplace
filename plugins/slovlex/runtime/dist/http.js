const DEFAULT_HEADERS = {
    "user-agent": "slov-lex-mcp/1.3 (+https://github.com/Omni-Legal-Products/mcp-slovlex) Mozilla/5.0",
    accept: "*/*",
};
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
async function fetchLimited(url, options) {
    const limit = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`GET ${url} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`)), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
        const response = await (options.fetchImpl ?? fetch)(url, {
            method: "GET",
            headers: { ...DEFAULT_HEADERS, ...(options.headers ?? {}) },
            signal: controller.signal,
        });
        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > limit) {
            await response.body?.cancel();
            throw new Error(`Response from ${url} exceeds maximum size of ${limit} bytes`);
        }
        if (!response.body)
            return { response, body: new Uint8Array() };
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > limit) {
                await reader.cancel();
                throw new Error(`Response from ${url} exceeds maximum size of ${limit} bytes`);
            }
            chunks.push(value);
        }
        const body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return { response, body };
    }
    finally {
        clearTimeout(timeout);
    }
}
function throwHttpError(url, response, body) {
    const snippet = new TextDecoder("utf-8").decode(body.slice(0, 500)).replace(/\s+/g, " ").trim();
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText} :: ${snippet}`);
}
export async function httpGetText(url, options = {}) {
    const { response, body } = await fetchLimited(url, options);
    if (!response.ok)
        throwHttpError(url, response, body);
    return new TextDecoder("utf-8").decode(body);
}
export async function httpGetJson(url, options = {}) {
    const text = await httpGetText(url, {
        ...options,
        headers: { accept: "application/json", ...(options.headers ?? {}) },
    });
    try {
        return JSON.parse(text);
    }
    catch (e) {
        throw new Error(`Invalid JSON from ${url}: ${e.message}`);
    }
}
export async function httpGetBinary(url, options = {}) {
    const { response, body } = await fetchLimited(url, options);
    if (!response.ok)
        throwHttpError(url, response, body);
    return {
        body,
        contentType: response.headers.get("content-type") ?? undefined,
        contentDisposition: response.headers.get("content-disposition") ?? undefined,
    };
}
