import { UvoSourceError } from "./uvo-client.js";
const SENSITIVE_KEYS = new Set([
    "name", "meno", "query", "ico", "noticeid", "authorization", "cookie", "token",
    "password", "secret", "url", "uri", "path", "body", "sourceip", "remoteaddress",
    "issuer", "storepath", "header", "headers", "clientid", "redirecturi",
]);
function isSensitiveKey(key) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return SENSITIVE_KEYS.has(normalized)
        || ["authorization", "cookie", "token", "password", "secret", "url", "uri", "path", "body", "headers"].some((part) => normalized.endsWith(part));
}
export function redact(value, seen = new WeakSet()) {
    if (Array.isArray(value))
        return value.map((entry) => redact(entry, seen));
    if (!value || typeof value !== "object")
        return value;
    if (value instanceof Error)
        return safeError(value);
    if (seen.has(value))
        return "[REDACTED]";
    seen.add(value);
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
        output[key] = isSensitiveKey(key) ? "[REDACTED]" : redact(entry, seen);
    }
    return output;
}
const messages = {
    UVO_INPUT: "Input was invalid.",
    UVO_HTTP: "Public source request failed.",
    UVO_TIMEOUT: "Public source request timed out.",
    UVO_CONTENT_TYPE: "Public source returned an unsupported content type.",
    UVO_SCHEMA: "Public source response was invalid.",
    UVO_UNAVAILABLE: "Public source is temporarily unavailable; this is not an empty result.",
    UVO_NOT_FOUND: "Public source has no such record.",
    UVO_PAGE_OUT_OF_RANGE: "Requested page is beyond the last result page.",
};
export function safeError(error) {
    const candidate = error;
    const code = candidate && typeof candidate.code === "string" && Object.hasOwn(messages, candidate.code)
        ? candidate.code
        : error instanceof UvoSourceError ? error.code : "UVO_HTTP";
    return { code, message: messages[code] };
}
export function safeLog(event, fields = {}) {
    return JSON.stringify({ event, ...redact(fields) });
}
