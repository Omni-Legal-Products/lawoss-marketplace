import { OvSourceError } from "./ov-client.js";
const SENSITIVE_KEYS = new Set([
    "name", "meno", "query", "ico", "idformular", "authorization", "cookie", "token",
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
    OV_INPUT: "Input was invalid.",
    OV_HTTP: "Public source request failed.",
    OV_TIMEOUT: "Public source request timed out.",
    OV_CONTENT_TYPE: "Public source returned an unsupported content type.",
    OV_SCHEMA: "Public source response was invalid.",
};
export function safeError(error) {
    const candidate = error;
    const code = candidate && typeof candidate.code === "string" && Object.hasOwn(messages, candidate.code)
        ? candidate.code
        : error instanceof OvSourceError ? error.code : "OV_HTTP";
    return { code, message: messages[code] };
}
export function safeLog(event, fields = {}) {
    return JSON.stringify({ event, ...redact(fields) });
}
