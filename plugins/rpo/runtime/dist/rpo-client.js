import { SearchResponseSchema, EntityDetailSchema, } from "./types.js";
const DEFAULT_BASE = "https://api.statistics.sk/rpo/v1/";
/** Error carrying the HTTP status so the MCP layer can map it to guidance. */
export class RpoApiError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = "RpoApiError";
    }
}
export class RpoClient {
    base;
    fetchImpl;
    timeoutMs;
    retries;
    constructor(opts = {}) {
        // RPO_BASE_URL env override; trailing slash normalized so path-joining is stable.
        const envBase = process.env.RPO_BASE_URL?.trim();
        const raw = opts.baseUrl ?? (envBase && envBase.length > 0 ? envBase : DEFAULT_BASE);
        this.base = raw.endsWith("/") ? raw : `${raw}/`;
        this.fetchImpl = opts.fetchImpl ?? fetch;
        this.timeoutMs = opts.timeoutMs ?? 30000;
        this.retries = opts.retries ?? 2;
    }
    async getJson(path) {
        let lastErr;
        for (let attempt = 0; attempt <= this.retries; attempt++) {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
            try {
                const res = await this.fetchImpl(`${this.base}${path}`, {
                    signal: ctrl.signal,
                    headers: { accept: "application/json" },
                });
                if (!res.ok) {
                    // 5xx (incl. the 500 RPO throws on overly broad queries) and the
                    // transient 000-style dropped connection are worth retrying.
                    if (res.status >= 500 && attempt < this.retries) {
                        lastErr = new RpoApiError(`RPO API request failed: HTTP ${res.status}.`, res.status);
                        await backoff(attempt);
                        continue;
                    }
                    throw new RpoApiError(`RPO API request failed: HTTP ${res.status}.`, res.status);
                }
                // Výpadkové stránky štátnych registrov chodia ako HTML so stavom 200,
                // takže res.ok o ničom nesvedčí a JSON.parse by vyhodil
                // "Unexpected token '<'" — to vyzerá ako chyba tohto servera, nie ako
                // nedostupný register. registeruz.sk aj sluzby.orsr.sk to robia presne
                // takto (RUZ-MCP#8, orsr-mcp#11).
                const text = await res.text();
                const contentType = res.headers?.get?.("content-type") ?? "";
                if (text.trimStart().startsWith("<") || contentType.toLowerCase().includes("text/html")) {
                    throw new RpoApiError("Register právnických osôb je momentálne nedostupný. " +
                        "Zdroj vrátil HTML stránku namiesto JSON. Skús to neskôr.", 503);
                }
                try {
                    return JSON.parse(text);
                }
                catch {
                    throw new RpoApiError("RPO API vrátilo odpoveď, ktorá nie je platný JSON.", 502);
                }
            }
            catch (err) {
                if (err instanceof RpoApiError)
                    throw err;
                // Network/abort error: retry with backoff.
                lastErr = err;
                if (attempt < this.retries) {
                    await backoff(attempt);
                    continue;
                }
                throw err;
            }
            finally {
                clearTimeout(t);
            }
        }
        throw lastErr ?? new Error("RPO API request failed");
    }
    /** Raw GET /search. Strips the CC-BY license blob from the parsed result. */
    async search(params) {
        const qs = buildSearchQuery(params);
        const raw = await this.getJson(`search?${qs}`);
        const parsed = SearchResponseSchema.parse(raw);
        delete parsed.license;
        return parsed;
    }
    /** Raw GET /entity/{id}. id is the INTERNAL RPO id, NOT the IČO. */
    async getEntityById(id, opts = {}) {
        const qs = new URLSearchParams();
        if (opts.showHistoricalData !== undefined)
            qs.set("showHistoricalData", String(opts.showHistoricalData));
        if (opts.showOrganizationUnits !== undefined)
            qs.set("showOrganizationUnits", String(opts.showOrganizationUnits));
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        const raw = await this.getJson(`entity/${encodeURIComponent(String(id))}${suffix}`);
        const parsed = EntityDetailSchema.parse(raw);
        delete parsed.license;
        return parsed;
    }
    /** Two-step IČO -> id resolution. Returns the internal id or null. */
    async resolveIdByIco(ico) {
        const res = await this.search({ identifier: ico });
        const first = res.results?.[0];
        return first ? first.id : null;
    }
    /** Convenience: full detail by IČO (search by identifier, then fetch detail). */
    async getEntityByIco(ico, opts = {}) {
        const id = await this.resolveIdByIco(ico);
        if (id === null)
            return null;
        return this.getEntityById(id, opts);
    }
}
function backoff(attempt) {
    // 250ms, 500ms, 1000ms ...
    const ms = 250 * 2 ** attempt;
    return new Promise((r) => setTimeout(r, ms));
}
/** Build the /search query string from typed params (booleans -> "true"/"false"). */
export function buildSearchQuery(params) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "")
            continue;
        qs.set(key, typeof value === "boolean" ? String(value) : String(value));
    }
    return qs.toString();
}
// ---------------------------------------------------------------------------
// Pure normalization helpers (no network — directly unit-tested via fixtures)
// ---------------------------------------------------------------------------
/** The current entry of a history array = no validTo, else latest validFrom. */
export function pickCurrent(arr) {
    if (!arr || arr.length === 0)
        return undefined;
    const open = arr.filter((x) => !x.validTo);
    const pool = open.length > 0 ? open : arr;
    return pool.reduce((best, cur) => (cur.validFrom ?? "") >= (best.validFrom ?? "") ? cur : best);
}
export function currentIco(summary) {
    return pickCurrent(summary.identifiers)?.value;
}
export function currentName(summary) {
    return pickCurrent(summary.fullNames)?.value;
}
export function formatAddress(a) {
    if (!a)
        return undefined;
    const streetPart = [a.street, a.buildingNumber].filter(Boolean).join(" ").trim();
    const cityPart = [a.postalCodes?.[0], a.municipality?.value].filter(Boolean).join(" ").trim();
    const parts = [streetPart, cityPart, a.country?.value].filter((p) => p && p.length > 0);
    const full = parts.join(", ");
    return full.length > 0 ? full : undefined;
}
export function normalizeAddress(a) {
    return {
        full: formatAddress(a) ?? "",
        street: a.street,
        buildingNumber: a.buildingNumber,
        postalCode: a.postalCodes?.[0],
        municipality: a.municipality?.value,
        country: a.country?.value,
        validFrom: a.validFrom,
        validTo: a.validTo,
    };
}
export function currentAddress(arr) {
    return formatAddress(pickCurrent(arr));
}
/** Map a raw search result entity into a token-lean summary view. */
export function toSummaryView(e) {
    return {
        id: e.id,
        ico: currentIco(e),
        name: currentName(e),
        address: currentAddress(e.addresses),
        establishment: e.establishment,
        sourceRegister: e.sourceRegister?.value?.value,
        dbModificationDate: e.dbModificationDate,
    };
}
export function normalizeSearch(res) {
    return (res.results ?? []).map(toSummaryView);
}
/** Map a full /entity/{id} detail record into a structured, current-resolved view. */
export function toDetailView(d) {
    const statutoryBodies = (d.statutoryBodies ?? []).map((s) => ({
        name: s.personName?.formatedName ?? s.companyName,
        role: s.stakeholderType?.value,
        memberType: s.statutoryBodyMember?.value,
        address: formatAddress(s.address),
        validFrom: s.validFrom,
    }));
    return {
        id: d.id,
        ico: currentIco(d),
        name: currentName(d),
        nameHistory: (d.fullNames ?? []).map((n) => ({
            value: n.value,
            validFrom: n.validFrom,
            validTo: n.validTo,
        })),
        address: currentAddress(d.addresses),
        addressHistory: (d.addresses ?? []).map(normalizeAddress),
        legalForm: pickCurrent(d.legalForms)?.value?.value,
        establishment: d.establishment,
        sourceRegister: d.sourceRegister?.value?.value,
        registrationOffices: (d.sourceRegister?.registrationOffices ?? [])
            .map((o) => o.value)
            .filter((v) => Boolean(v)),
        registrationNumbers: (d.sourceRegister?.registrationNumbers ?? [])
            .map((n) => n.value)
            .filter((v) => Boolean(v)),
        activities: (d.activities ?? []).map((a) => ({
            description: a.economicActivityDescription,
            validFrom: a.validFrom,
        })),
        statutoryBodies,
        mainActivity: d.statisticalCodes?.mainActivity?.value,
        esa2010: d.statisticalCodes?.esa2010?.value,
        dbModificationDate: d.dbModificationDate,
    };
}
/** Build a simplified RelatedEntitiesView from raw detail predecessors/successors. */
export function toRelatedView(detail) {
    const preds = Array.isArray(detail.predecessors) ? detail.predecessors : [];
    const succs = Array.isArray(detail.successors) ? detail.successors : [];
    const mapEntity = (r) => ({
        identifier: r.identifier,
        fullName: r.fullName,
        address: formatSimpleAddress(r.address),
        validFrom: r.validFrom,
        validTo: r.validTo,
    });
    return {
        id: detail.id,
        ico: currentIco(detail),
        fullName: currentName(detail),
        predecessors: preds.map(mapEntity),
        successors: succs.map(mapEntity),
        noRelations: preds.length === 0 && succs.length === 0,
    };
}
function formatSimpleAddress(addr) {
    if (!addr)
        return undefined;
    const parts = [addr.street, addr.buildingNumber, addr.municipality?.value].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : undefined;
}
