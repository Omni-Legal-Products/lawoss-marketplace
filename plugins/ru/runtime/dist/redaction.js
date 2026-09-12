import { RuMcpError } from "./types.js";
const PUBLIC_MESSAGES = {
    RU_INPUT: "RU input is invalid.",
    RU_INPUT_TOO_LARGE: "RU input exceeds the supported limit.",
    RU_SOURCE_HTTP: "RU source returned an unsupported HTTP response.",
    RU_SOURCE_REDIRECT: "RU source redirect was rejected.",
    RU_SOURCE_CONTENT_TYPE: "RU source returned an unsupported content type.",
    RU_SOURCE_SIZE: "RU source response exceeds the supported limit.",
    RU_SOURCE_PARSE: "RU source response could not be validated.",
    RU_SOURCE_TIMEOUT: "RU source request timed out.",
    RU_INTERNAL: "RU request failed safely.",
};
export function publicRuError(error) {
    const code = error instanceof RuMcpError ? error.code : "RU_INTERNAL";
    return { code, message: PUBLIC_MESSAGES[code] };
}
export function safeLogEvent(event, fields = {}) {
    const allowed = ["status", "durationMs", "method", "route", "errorCode", "authMode", "ready"];
    const payload = { component: "ru-mcp", event };
    for (const key of allowed) {
        const value = fields[key];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
            payload[key] = value;
    }
    console.error(JSON.stringify(payload));
}
