const REDACTED = "[REDACTED]";
const sensitiveKey = /address|authorization|body|client(?:id|secret)?|credential|full.?name|ico|identifier|issuer|name|password|path|query|redirect.?uri|secret|token|url/i;
function isSensitiveKey(key) {
    return sensitiveKey.test(key) || key === "id" || /(?:[_-]ids?|Ids?)$/.test(key);
}
/** Redact person-identifying, target, credential, URL, and filesystem values by key. */
export function redactToolInput(value) {
    if (!value || typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.map((item) => redactToolInput(item));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveKey(key) ? REDACTED : redactToolInput(item),
    ]));
}
export function safeErrorClass(error) {
    return error instanceof Error && error.name === "RpoApiError" ? "RpoApiError" : "Error";
}
/**
 * Emit only explicitly allowed, bounded operational metadata. Callers cannot
 * accidentally attach headers, bodies, addresses, URLs, paths, or exceptions.
 */
export function safeOperationalLog(level, event, fields = {}) {
    const safeEvent = safeLabel(event, "event");
    const payload = { event: safeEvent };
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined)
            continue;
        payload[key] = typeof value === "number" ? finiteNonNegative(value) : safeLabel(value, key);
    }
    console[level](JSON.stringify(payload));
}
function safeLabel(value, fallback) {
    return /^[A-Za-z0-9_/-]{1,64}$/.test(value) ? value : fallback;
}
function finiteNonNegative(value) {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}
