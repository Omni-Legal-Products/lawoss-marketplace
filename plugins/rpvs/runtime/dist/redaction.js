const ERROR_MESSAGES = {
    INVALID_INPUT: "Provide exactly one of ico or partnerId.",
    INVALID_ICO: "IČO must contain exactly eight ASCII digits.",
    NOT_FOUND: "No matching RPVS partner was found.",
    UNSAFE_PAGINATION_LINK: "RPVS rejected an unsafe pagination link.",
    UNSAFE_UPSTREAM_BASE: "RPVS upstream configuration is unsafe.",
};
/** Convert any internal failure to a stable, non-identifying public contract. */
export function publicError(error) {
    const internal = error instanceof Error ? error.message : "";
    const knownCode = Object.keys(ERROR_MESSAGES).find((code) => internal.startsWith(code));
    if (knownCode)
        return { code: knownCode, message: ERROR_MESSAGES[knownCode] };
    return { code: "UPSTREAM_ERROR", message: "RPVS request failed safely." };
}
/** Emit only an explicit non-sensitive observability allowlist. */
export function safeLogEvent(event, fields = {}) {
    const allowedKeys = [
        "status", "durationMs", "method", "route", "attempt", "maxAttempts",
        "retriable", "errorCode", "authMode", "ready",
    ];
    const payload = {
        ts: new Date().toISOString(),
        component: "rpvs-mcp",
        event,
    };
    for (const key of allowedKeys) {
        const value = fields[key];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            payload[key] = value;
        }
    }
    // stderr keeps stdio's stdout exclusively available for MCP protocol frames.
    console.error(JSON.stringify(payload));
}
