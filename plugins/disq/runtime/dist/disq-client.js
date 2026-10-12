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
    DISQ_NOT_FOUND: "The public source has no record with this registreGuid (HTTP 404).",
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
                if (response.status === 404)
                    throw new DisqSourceError("DISQ_NOT_FOUND");
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
        let raw;
        try {
            raw = await this.getJson(`v1/diskvalifikacia?${buildSearchQuery(normalized)}`);
        }
        catch (error) {
            // Only a detail lookup can legitimately miss a record.
            if (error instanceof DisqSourceError && error.code === "DISQ_NOT_FOUND")
                throw new DisqSourceError("DISQ_HTTP");
            throw error;
        }
        return parseSearch(raw);
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
    /**
     * Name query. Titles and single-letter initials are removed first (the
     * source returns 0 for them, see normalizeNameQuery); a query left empty is
     * rejected because it would list the whole register.
     */
    async check(name, size = 200) {
        const normalized = normalizeNameQuery(name);
        if (!normalized.query)
            inputError();
        const result = await this.search({ query: normalized.query, size });
        return toCheckView(normalized, result, this.clock);
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
// Academic and professional titles (folded, without the dot), removed with or without the dot.
const TITLES = new Set([
    "bc", "bca", "mgr", "ing", "judr", "mudr", "mvdr", "mddr", "phdr", "rndr",
    "paeddr", "pharmdr", "thdr", "thlic", "jcdr", "icdr", "phd", "artd", "csc",
    "drsc", "doc", "prof", "dr", "hc", "mba", "llm", "dis", "akad", "dipl",
]);
// Ambiguous short forms, removed only when written with the dot ("Ing. arch.").
const DOTTED_ONLY_TITLES = new Set(["arch", "art", "ma", "ba", "msc", "bsc", "mpa", "mph"]);
/**
 * The source matches every query token as a word prefix, in any order, and
 * ignores diacritics (verified 2026-10-09). A token it cannot match makes the
 * whole query return 0: "Ing. <name> <surname>", "ing <name> <surname>" and
 * "M. <surname>" all came back empty for a person who is in the register.
 * Titles and single-letter initials are therefore removed.
 */
export function normalizeNameQuery(name) {
    const folded = foldName(name)
        .replace(/\bll\.\s?m\./g, "llm.")
        .replace(/\bh\.\s?c\./g, "hc.")
        .replace(/(\p{L})\.(?=\p{L}{2})/gu, "$1. ");
    const removedTitles = [];
    const removedInitials = [];
    const kept = [];
    for (const raw of folded.split(/[\s,;]+/u)) {
        const token = raw.replace(/^[^\p{L}\p{N}]+/u, "");
        const bare = token.replace(/\.+$/u, "");
        if (!bare)
            continue;
        if (TITLES.has(bare) || (token.endsWith(".") && DOTTED_ONLY_TITLES.has(bare)))
            removedTitles.push(token);
        else if (/^\p{L}$/u.test(bare))
            removedInitials.push(token);
        else
            kept.push(bare);
    }
    return { query: kept.join(" "), removedTitles, removedInitials };
}
function nameTokens(value) {
    try {
        return normalizeNameQuery(value).query.split(" ").filter(Boolean).sort().join(" ");
    }
    catch {
        return "";
    }
}
/** "exact" when the register name and the query carry the same tokens, otherwise "prefix". */
export function classifyNameMatch(query, meno) {
    const record = nameTokens(meno);
    return record !== "" && record === query.split(" ").filter(Boolean).sort().join(" ") ? "exact" : "prefix";
}
export function toMatchView(value, query = "") {
    const result = { registreGuid: value.registreGuid, meno: value.meno };
    for (const key of ["datumRozhodnutia", "sud", "adresa"])
        if (value[key] !== undefined)
            result[key] = value[key];
    result.matchType = classifyNameMatch(query, value.meno);
    return result;
}
export function toCheckView(normalized, response, clock = () => new Date()) {
    const q = typeof normalized === "string" ? { query: normalized, removedTitles: [], removedInitials: [] } : normalized;
    const matches = response.diskvalifikaciaList.map((row) => toMatchView(row, q.query));
    const reason = response.truncationReason;
    const truncated = Boolean(reason);
    const nameMatchFound = response.numFound > 0;
    const exactNameMatches = matches.filter((match) => match.matchType === "exact").length;
    const status = truncated ? "incomplete" : nameMatchFound ? "matches" : "no_match";
    const warnings = [];
    if (reason)
        warnings.push(`SOURCE_RESULTS_TRUNCATED_${reason}`);
    if (q.removedTitles.length)
        warnings.push("QUERY_TITLES_REMOVED");
    if (q.removedInitials.length)
        warnings.push("QUERY_INITIALS_REMOVED_BROADENED");
    if (nameMatchFound)
        warnings.push("NAME_MATCH_ONLY_IDENTITY_NOT_VERIFIED");
    if (exactNameMatches < matches.length)
        warnings.push("NON_EXACT_NAME_MATCHES_PRESENT");
    return {
        status,
        sourceValidated: true,
        retrievedAt: clock().toISOString(),
        updateDate: response.updateDate,
        numFound: response.numFound,
        returnedCount: matches.length,
        truncated,
        ...(reason ? { truncationReason: reason } : {}),
        warnings,
        query: q.query,
        ...(q.removedTitles.length ? { removedTitles: q.removedTitles } : {}),
        ...(q.removedInitials.length ? { removedInitials: q.removedInitials } : {}),
        nameMatchFound,
        identityVerified: false,
        exactNameMatches,
        disqualified: nameMatchFound,
        matches,
    };
}
const INTERVAL_TIME_ZONE = "Europe/Bratislava";
export const INTERVAL_BASIS = "Assumption: both ends are inclusive (vylucenieOd <= today <= vylucenieDo), today being the calendar date in Europe/Bratislava. " +
    "Whether vylucenieDo is legally the last day of the ban is not assessed.";
/** Strict DD.MM.YYYY as a sortable YYYYMMDD number; impossible dates (31.02.) are rejected. */
function skDayKey(value) {
    if (!isStrictSkDate(value))
        return undefined;
    const [day, month, year] = value.split(".").map(Number);
    return year * 10_000 + month * 100 + day;
}
/** The calendar day of `instant` in Europe/Bratislava, independent of the process time zone. */
function bratislavaDay(instant) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: INTERVAL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
    const get = (type) => parts.find((part) => part.type === type).value;
    const [year, month, day] = [get("year"), get("month"), get("day")];
    return { key: Number(`${year}${month}${day}`), iso: `${year}-${month}-${day}` };
}
export function toDetailView(value, clock = () => new Date()) {
    const updateDate = typeof value.updateDate === "string" && isStrictSkDate(value.updateDate) ? value.updateDate : undefined;
    if (!value.registreGuid || !value.meno || !updateDate)
        schemaError();
    const warnings = [];
    const instant = clock();
    const today = bratislavaDay(instant);
    const hasOd = typeof value.vylucenieOd === "string" && value.vylucenieOd !== "";
    const hasDo = typeof value.vylucenieDo === "string" && value.vylucenieDo !== "";
    const from = hasOd ? skDayKey(value.vylucenieOd) : undefined;
    const to = hasDo ? skDayKey(value.vylucenieDo) : undefined;
    let currentlyDisqualified;
    if (from !== undefined && to !== undefined && from <= to) {
        currentlyDisqualified = today.key >= from && today.key <= to;
    }
    else {
        warnings.push("DISQUALIFICATION_INTERVAL_UNAVAILABLE");
        if ((hasOd && from === undefined) || (hasDo && to === undefined) || (from !== undefined && to !== undefined)) {
            warnings.push("DISQUALIFICATION_INTERVAL_INVALID");
        }
    }
    const result = {
        status: "detail",
        sourceValidated: true,
        retrievedAt: instant.toISOString(),
        updateDate,
        registreGuid: value.registreGuid,
        meno: value.meno,
        evaluatedOn: today.iso,
        intervalBasis: INTERVAL_BASIS,
        warnings,
    };
    const optional = ["datumRozhodnutia", "sud", "adresa", "spisovaZnacka", "cisloKonania", "poznamka"];
    for (const key of optional)
        if (typeof value[key] === "string")
            result[key] = value[key];
    if (from !== undefined && typeof value.vylucenieOd === "string")
        result.vylucenieOd = value.vylucenieOd;
    if (to !== undefined && typeof value.vylucenieDo === "string")
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
