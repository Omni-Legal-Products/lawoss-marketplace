import { AutocompleteResponseSchema, DiskvalifikaciaListResponseSchema, DiskvalifikaciaSchema, isStrictSkDate, } from "./types.js";
const DEFAULT_BASE = "https://obcan.justice.sk/pilot/api/ress-isu-service/";
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const MAX_ROWS = 2_000;
export const MAX_UPSTREAM_CONCURRENCY = 4;
const MAX_INPUT_BYTES = 256;
const UNSAFE_INPUT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
let activeUpstreamRequests = 0;
const SAFE_MESSAGES = {
    DISQ_HTTP: "Public source request failed.",
    DISQ_TIMEOUT: "Public source request timed out.",
    DISQ_CONTENT_TYPE: "Public source returned an unsupported content type.",
    DISQ_SCHEMA: "Public source response was invalid.",
    DISQ_INPUT: "Input was invalid.",
};
export class DisqSourceError extends Error {
    code;
    constructor(code) {
        super(SAFE_MESSAGES[code]);
        this.code = code;
        this.name = "DisqSourceError";
    }
}
/** Backwards-compatible error export without legacy body/path fields. */
export class DisqApiError extends DisqSourceError {
}
function inputError() { throw new DisqSourceError("DISQ_INPUT"); }
function schemaError() { throw new DisqSourceError("DISQ_SCHEMA"); }
function boundedInput(value, allowEmpty = false) {
    if (typeof value !== "string")
        inputError();
    const trimmed = value.trim();
    if ((!allowEmpty && !trimmed) || Buffer.byteLength(trimmed, "utf8") > MAX_INPUT_BYTES || UNSAFE_INPUT.test(trimmed))
        inputError();
    return trimmed;
}
function parseBoundedInteger(value, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value === "string" && !/^[0-9]+$/.test(value.trim()))
        inputError();
    const parsed = typeof value === "string" ? Number(value.trim()) : value;
    if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_ROWS)
        inputError();
    return parsed;
}
function sourceBase(value) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        inputError();
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash)
        inputError();
    parsed.pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    return parsed;
}
function isJsonContentType(value) {
    if (!value)
        return false;
    const mediaType = value.split(";", 1)[0].trim().toLowerCase();
    return mediaType === "application/json" || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType);
}
async function readBoundedBody(response) {
    const declared = response.headers.get("content-length");
    if (declared !== null) {
        if (!/^\d+$/.test(declared))
            throw new DisqSourceError("DISQ_HTTP");
        const bytes = Number(declared);
        if (!Number.isSafeInteger(bytes) || bytes > MAX_RESPONSE_BYTES)
            throw new DisqSourceError("DISQ_HTTP");
    }
    if (!response.body)
        return "";
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!value)
                continue;
            total += value.byteLength;
            if (total > MAX_RESPONSE_BYTES) {
                await reader.cancel().catch(() => undefined);
                throw new DisqSourceError("DISQ_HTTP");
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(joined);
    }
    catch {
        throw new DisqSourceError("DISQ_SCHEMA");
    }
}
function parseJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        throw new DisqSourceError("DISQ_SCHEMA");
    }
}
function parseSearch(value) {
    const parsed = DiskvalifikaciaListResponseSchema.safeParse(value);
    if (!parsed.success)
        schemaError();
    const list = parsed.data.diskvalifikaciaList;
    if (parsed.data.numFound < list.length)
        schemaError();
    if (list.length > MAX_ROWS) {
        return { ...parsed.data, diskvalifikaciaList: list.slice(0, MAX_ROWS), truncationReason: "MAX_ROWS" };
    }
    if (parsed.data.numFound > list.length)
        return { ...parsed.data, truncationReason: "SOURCE_WINDOW" };
    return parsed.data;
}
export class DisqClient {
    base;
    fetchImpl;
    timeoutMs;
    retries;
    clock;
    constructor(options = {}) {
        const env = options.env ?? process.env;
        const explicit = options.baseUrl?.trim();
        const configured = explicit || env.DISQ_BASE_URL?.trim() || DEFAULT_BASE;
        this.base = sourceBase(configured);
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.timeoutMs = options.timeoutMs ?? 30_000;
        this.retries = options.retries ?? 2;
        this.clock = options.now ?? (() => new Date());
        if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000)
            inputError();
        if (!Number.isSafeInteger(this.retries) || this.retries < 0 || this.retries > 5)
            inputError();
    }
    url(path) {
        const result = new URL(path, this.base);
        if (result.origin !== this.base.origin || !result.pathname.startsWith(this.base.pathname))
            inputError();
        return result;
    }
    async requestOnce(url, signal) {
        if (activeUpstreamRequests >= MAX_UPSTREAM_CONCURRENCY)
            throw new DisqSourceError("DISQ_HTTP");
        activeUpstreamRequests += 1;
        try {
            const response = await this.fetchImpl(url.href, {
                signal,
                redirect: "error",
                headers: { accept: "application/json" },
            });
            if (response.status !== 200) {
                if (response.status >= 500)
                    throw Object.assign(new DisqSourceError("DISQ_HTTP"), { retryable: true });
                throw new DisqSourceError("DISQ_HTTP");
            }
            if (!isJsonContentType(response.headers.get("content-type")))
                throw new DisqSourceError("DISQ_CONTENT_TYPE");
            return parseJson(await readBoundedBody(response));
        }
        finally {
            activeUpstreamRequests -= 1;
        }
    }
    async getJson(path) {
        const url = this.url(path);
        for (let attempt = 0; attempt <= this.retries; attempt += 1) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);
            try {
                return await this.requestOnce(url, controller.signal);
            }
            catch (error) {
                const abort = error instanceof DOMException && error.name === "AbortError";
                const retryable = abort || !(error instanceof DisqSourceError) || Boolean(error.retryable);
                if (retryable && attempt < this.retries) {
                    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
                    continue;
                }
                if (abort)
                    throw new DisqSourceError("DISQ_TIMEOUT");
                if (error instanceof DisqSourceError)
                    throw new DisqSourceError(error.code);
                throw new DisqSourceError("DISQ_HTTP");
            }
            finally {
                clearTimeout(timer);
            }
        }
        throw new DisqSourceError("DISQ_HTTP");
    }
    async search(params = {}) {
        const normalized = { ...params };
        if (normalized.query !== undefined)
            normalized.query = foldName(normalized.query);
        normalized.size = parseBoundedInteger(normalized.size, 200);
        for (const key of ["sudFacetFilter", "obecFacetFilter", "stavFacetFilter"]) {
            if (normalized[key] !== undefined)
                normalized[key] = boundedInput(normalized[key]);
        }
        return parseSearch(await this.getJson(`v1/diskvalifikacia?${buildSearchQuery(normalized)}`));
    }
    async getByGuid(registreGuid) {
        const guid = boundedInput(registreGuid);
        const parsed = DiskvalifikaciaSchema.safeParse(await this.getJson(`v1/diskvalifikacia/${encodeURIComponent(guid)}`));
        if (!parsed.success || !parsed.data.updateDate || !isStrictSkDate(parsed.data.updateDate))
            schemaError();
        return parsed.data;
    }
    async autocomplete(query, limit = 10) {
        const folded = foldName(query);
        const boundedLimit = parseBoundedInteger(limit, 10);
        const raw = await this.getJson(`v1/diskvalifikacia/autocomplete?${new URLSearchParams({ query: folded, limit: String(boundedLimit) })}`);
        const parsed = AutocompleteResponseSchema.safeParse(raw);
        if (!parsed.success)
            schemaError();
        return parsed.data.slice(0, MAX_ROWS);
    }
    async check(name, size = 200) {
        const folded = foldName(name);
        const result = await this.search({ query: folded, size });
        return toCheckView(folded, result, this.clock);
    }
}
export function buildSearchQuery(params) {
    const query = new URLSearchParams();
    if (params.query)
        query.set("query", params.query);
    if (params.size !== undefined)
        query.set("size", String(params.size));
    if (params.sudFacetFilter)
        query.set("sudFacetFilter", params.sudFacetFilter);
    if (params.obecFacetFilter)
        query.set("obecFacetFilter", params.obecFacetFilter);
    if (params.stavFacetFilter)
        query.set("stavFacetFilter", params.stavFacetFilter);
    return query.toString();
}
export function foldName(name) {
    const value = boundedInput(name);
    const folded = value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
    if (!folded || Buffer.byteLength(folded, "utf8") > MAX_INPUT_BYTES || UNSAFE_INPUT.test(folded))
        inputError();
    return folded;
}
export function toMatchView(value) {
    const result = { registreGuid: value.registreGuid, meno: value.meno };
    for (const key of ["datumRozhodnutia", "sud", "adresa"])
        if (value[key] !== undefined)
            result[key] = value[key];
    return result;
}
export function toCheckView(query, response, clock = () => new Date()) {
    const matches = response.diskvalifikaciaList.map(toMatchView);
    const reason = response.truncationReason;
    const truncated = Boolean(reason);
    const status = truncated ? "incomplete" : response.numFound === 0 ? "no_match" : "matches";
    return {
        status,
        sourceValidated: true,
        retrievedAt: clock().toISOString(),
        updateDate: response.updateDate,
        numFound: response.numFound,
        returnedCount: matches.length,
        truncated,
        ...(reason ? { truncationReason: reason } : {}),
        warnings: reason ? [`SOURCE_RESULTS_TRUNCATED_${reason}`] : [],
        query,
        disqualified: response.numFound > 0,
        matches,
    };
}
function utcDate(value) {
    if (!isStrictSkDate(value))
        return undefined;
    const [day, month, year] = value.split(".").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}
export function toDetailView(value, clock = () => new Date()) {
    const updateDate = typeof value.updateDate === "string" && isStrictSkDate(value.updateDate) ? value.updateDate : undefined;
    if (!value.registreGuid || !value.meno || !updateDate)
        schemaError();
    const warnings = [];
    const from = typeof value.vylucenieOd === "string" ? utcDate(value.vylucenieOd) : undefined;
    const to = typeof value.vylucenieDo === "string" ? utcDate(value.vylucenieDo) : undefined;
    let currentlyDisqualified;
    if (from && to && from <= to) {
        const instant = clock();
        const today = Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());
        currentlyDisqualified = today >= from.getTime() && today <= to.getTime();
    }
    else
        warnings.push("DISQUALIFICATION_INTERVAL_UNAVAILABLE");
    const result = {
        status: "detail",
        sourceValidated: true,
        retrievedAt: clock().toISOString(),
        updateDate,
        registreGuid: value.registreGuid,
        meno: value.meno,
        warnings,
    };
    const optional = ["datumRozhodnutia", "sud", "adresa", "spisovaZnacka", "cisloKonania", "poznamka"];
    for (const key of optional)
        if (typeof value[key] === "string")
            result[key] = value[key];
    if (from && typeof value.vylucenieOd === "string")
        result.vylucenieOd = value.vylucenieOd;
    if (to && typeof value.vylucenieDo === "string")
        result.vylucenieDo = value.vylucenieDo;
    if (currentlyDisqualified !== undefined)
        result.currentlyDisqualified = currentlyDisqualified;
    const requiredDetailFields = ["spisovaZnacka", "cisloKonania", "vylucenieOd", "vylucenieDo", "poznamka"];
    const missing = requiredDetailFields.filter((key) => !(key in result));
    if (missing.length)
        result.missingFields = [...missing];
    return result;
}
export function courtFacets(response) {
    const filter = (response.filterList ?? []).find((entry) => entry.filterName === "sud_string");
    return (filter?.facetValueList ?? []).map(({ text, count }) => ({ ...(text !== undefined ? { text } : {}), ...(count !== undefined ? { count } : {}) }));
}
