import { DisqSourceError } from "./disq-client.js";
const SENSITIVE_KEYS = new Set([
    "name", "meno", "query", "dob", "dateofbirth", "ico", "registreguid", "guid",
    "authorization", "cookie", "token", "password", "secret", "url", "uri", "path",
    "body", "sourceip", "remoteaddress", "issuer", "storepath", "header", "headers",
    "clientid", "redirecturi",
]);
function isSensitiveKey(key) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return SENSITIVE_KEYS.has(normalized)
        || ["authorization", "cookie", "token", "password", "secret", "guid", "url", "uri", "path", "body", "headers"].some((part) => normalized.endsWith(part));
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
export function safeError(error) {
    const candidate = error;
    const code = candidate && typeof candidate.code === "string" && ["DISQ_HTTP", "DISQ_TIMEOUT", "DISQ_CONTENT_TYPE", "DISQ_SCHEMA", "DISQ_INPUT"].includes(candidate.code)
        ? candidate.code
        : undefined;
    if (error instanceof DisqSourceError || code) {
        const messages = {
            DISQ_HTTP: "Public source request failed.", DISQ_TIMEOUT: "Public source request timed out.",
            DISQ_CONTENT_TYPE: "Public source returned an unsupported content type.", DISQ_SCHEMA: "Public source response was invalid.",
            DISQ_INPUT: "Input was invalid.",
        };
        const selected = error instanceof DisqSourceError ? error.code : code;
        return { code: selected, message: messages[selected] };
    }
    return { code: "DISQ_HTTP", message: "Public source request failed." };
}
export function safeLog(event, fields = {}) {
    return JSON.stringify({ event, ...redact(fields) });
}
