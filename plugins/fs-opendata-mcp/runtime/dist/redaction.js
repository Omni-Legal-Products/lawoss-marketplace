import { FsSourceError } from "./fs-client.js";
const SENSITIVE = /^(?:ico|ic_?dph|icDph|name|nazov.*|address|adresa|query|search|url|uri|authorization|cookie|key|apiKey|token|password|ip|sourceIp|body|path|input|headers?)$/i;
export function redact(value) {
    if (value instanceof Error)
        return safeError(value);
    if (Array.isArray(value))
        return value.map(redact);
    if (!value || typeof value !== "object")
        return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE.test(key) ? "[REDACTED]" : redact(item)]));
}
const SAFE_MESSAGES = {
    FS_INPUT: "Input validation failed.",
    FS_HTTP: "Source returned an unsuccessful status.",
    FS_REDIRECT: "Source redirect was rejected.",
    FS_CONTENT_TYPE: "Source did not return JSON.",
    FS_PARSE: "Source returned invalid JSON.",
    FS_SCHEMA: "Source response failed validation.",
    FS_TOTAL: "Source pagination totals were invalid.",
    FS_TIMEOUT: "Source query timed out.",
    FS_UPSTREAM: "Source query failed.",
};
export function safeError(error) {
    const code = error instanceof FsSourceError ? error.code : "FS_UPSTREAM";
    return { code, message: SAFE_MESSAGES[code] };
}
