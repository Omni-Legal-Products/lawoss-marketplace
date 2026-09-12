const REDACTED = "[REDACTED]";
const ENTITY_TARGET_KEYS = new Set([
    "query",
    "oddiel",
    "vlozka",
    "sud",
    "court",
    "filereferencecourt",
    "filereferencesection",
    "filereferenceinsertnumber",
    "corporatebodyfullnameorregistrationnumber",
    "corporatebodynamelike",
    "physicalpersonname",
    "physicalpersontype",
    "addressstreet",
    "addressnumber",
    "addressmunicipality",
    "legalform",
    "codelistcode",
]);
export function isEntityTargetKey(key) {
    const normalized = key.trim().toLowerCase();
    return normalized.startsWith("filter.") || ENTITY_TARGET_KEYS.has(normalized);
}
export function sanitizeUrlForLogs(url) {
    const clone = new URL(url.toString());
    for (const key of [...clone.searchParams.keys()]) {
        if (isEntityTargetKey(key))
            clone.searchParams.set(key, REDACTED);
    }
    return clone.toString();
}
export function redactEntityTargetInput(input) {
    if (!input || typeof input !== "object")
        return undefined;
    if (Array.isArray(input))
        return input.map(redactEntityTargetInput);
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        out[key] = isEntityTargetKey(key) ? REDACTED : redactNonTargetValue(value);
    }
    return out;
}
function redactNonTargetValue(value) {
    if (!value || typeof value !== "object")
        return value;
    return redactEntityTargetInput(value);
}
