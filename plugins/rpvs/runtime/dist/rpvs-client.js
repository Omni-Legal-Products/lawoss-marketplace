import { isIP } from "node:net";
import { safeLogEvent } from "./redaction.js";
// Default RPVS Open Data v4 base URL; overridable via env for tests / mirrors.
const DEFAULT_BASE_URL = "https://rpvs.gov.sk/opendatav2/";
// ---------------------------------------------------------------------------
// Pure helpers (no network) — unit-tested directly against fixtures
// ---------------------------------------------------------------------------
/** True for the temporally-current record of an append-only history (PlatnostDo == null). */
export function isCurrent(platnostDo) {
    return platnostDo === null || platnostDo === undefined || platnostDo === "";
}
/** Normalize a value that may be an empty string into null (RPVS uses "" for missing). */
function blankToNull(v) {
    if (v === null || v === undefined)
        return null;
    const t = v.trim();
    return t.length === 0 ? null : t;
}
/** Validate the canonical RPVS identifier without rewriting its meaning. */
export function normalizeIco(raw) {
    if (!/^[0-9]{8}$/.test(raw)) {
        throw new Error("INVALID_ICO: IČO must contain exactly eight ASCII digits.");
    }
    return raw;
}
/** Only the canonical representation is ever classified as an IČO. */
export function looksLikeIco(query) {
    return /^[0-9]{8}$/.test(query);
}
function looksLikeAmbiguousIco(query) {
    return /^[\p{N}\s.,\-/]+$/u.test(query) && /\p{N}/u.test(query);
}
function joinName(meno, priezvisko, titulPred, titulZa) {
    const parts = [blankToNull(titulPred), blankToNull(meno), blankToNull(priezvisko), blankToNull(titulZa)].filter((p) => p !== null);
    return parts.length ? parts.join(" ") : null;
}
export function normalizeAddress(a) {
    if (!a)
        return null;
    const street = blankToNull(a.MenoUlice);
    const num = blankToNull(a.OrientacneCislo) ?? blankToNull(a.SupisneCislo);
    const streetLine = street ? (num ? `${street} ${num}` : street) : null;
    const city = blankToNull(a.Mesto);
    const zip = blankToNull(a.Psc);
    const fullParts = [streetLine, [zip, city].filter(Boolean).join(" ") || null].filter((p) => p !== null && p.length > 0);
    return {
        street: streetLine,
        city,
        zip,
        full: fullParts.length ? fullParts.join(", ") : null,
    };
}
export function normalizePartnerSummary(p) {
    const name = blankToNull(p.ObchodneMeno) ?? joinName(p.Meno, p.Priezvisko, p.TitulPred, p.TitulZa);
    return {
        id: p.Id ?? null,
        ico: blankToNull(p.Ico),
        name,
        formaOsoby: blankToNull(p.FormaOsoby),
        validFrom: blankToNull(p.PlatnostOd),
        validTo: blankToNull(p.PlatnostDo),
        active: isCurrent(p.PlatnostDo),
    };
}
export function normalizeUbo(k) {
    return {
        id: k.Id ?? null,
        name: joinName(k.Meno, k.Priezvisko, k.TitulPred, k.TitulZa) ?? blankToNull(k.ObchodneMeno),
        dateOfBirth: blankToNull(k.DatumNarodenia),
        isPublicOfficial: k.JeVerejnyCinitel === true,
        nationality: blankToNull(k.StatnaPrislusnost?.Meno),
        address: normalizeAddress(k.Adresa),
        validFrom: blankToNull(k.PlatnostOd),
        validTo: blankToNull(k.PlatnostDo),
        current: isCurrent(k.PlatnostDo),
    };
}
export function normalizeAuthorizedPerson(o) {
    return {
        id: o.Id ?? null,
        name: blankToNull(o.ObchodneMeno) ?? joinName(o.Meno, o.Priezvisko),
        ico: blankToNull(o.Ico),
        formaOsoby: blankToNull(o.FormaOsoby),
        validFrom: blankToNull(o.PlatnostOd),
        validTo: blankToNull(o.PlatnostDo),
        current: isCurrent(o.PlatnostDo),
    };
}
export function normalizePublicOfficial(f) {
    return {
        id: f.Id ?? null,
        name: joinName(f.Meno, f.Priezvisko, f.TitulPred, f.TitulZa),
        function: blankToNull(f.Funkcia),
        validFrom: blankToNull(f.PlatnostOd),
        validTo: blankToNull(f.PlatnostDo),
        current: isCurrent(f.PlatnostDo),
    };
}
export function normalizeSanction(k) {
    return {
        id: k.Id ?? null,
        fileMark: blankToNull(k.SpisovaZnackaKonania),
        startedOn: blankToNull(k.DatumZacatiaKonania),
        endedOn: blankToNull(k.DatumSkonceniaKonania),
        decisionFinalOn: blankToNull(k.DatumPravoplatnostiRozhodnutia),
        decision: blankToNull(k.SposobRozhodnutiaKP),
    };
}
export function normalizeVerificationDocument(d) {
    return {
        id: d.Id ?? null,
        validFrom: blankToNull(d.PlatnyOd),
        validTo: blankToNull(d.PlatnyDo),
        insertNumber: d.CisloVlozky ?? null,
        current: isCurrent(d.PlatnyDo),
    };
}
/**
 * Build the full normalized partner detail from a raw Partneri entity plus
 * (optionally) the verification documents fetched separately by CisloVlozky.
 * Pure function — no network — so it is unit-testable against fixtures.
 */
export function buildPartnerDetail(partner, verificationDocs = []) {
    const partnerHistory = normalizeRelationRows(partner.PartneriVerejnehoSektora, isRawPartnerSummary, normalizePartnerSummary);
    const currentPartner = partnerHistory.find((p) => p.active) ?? partnerHistory[0] ?? null;
    const ubosAll = normalizeRelationRows(partner.KonecniUzivateliaVyhod, isRawUbo, normalizeUbo);
    const authAll = normalizeRelationRows(partner.OpravneneOsoby, isRawAuthorizedPerson, normalizeAuthorizedPerson);
    const officials = normalizeRelationRows(partner.VerejniFunkcionari, isRawPublicOfficial, normalizePublicOfficial);
    const sanctions = normalizeRelationRows(partner.KvalifikovanePodnety, isRawSanction, normalizeSanction);
    const docs = normalizeRelationRows(verificationDocs, isRawVerificationDocument, normalizeVerificationDocument);
    return {
        partnerId: partner.Id ?? null,
        insertNumber: partner.CisloVlozky ?? partner.Id ?? null,
        partner: currentPartner,
        partnerHistory,
        ubos: {
            current: ubosAll.filter((u) => u.current),
            all: ubosAll,
        },
        authorizedPersons: {
            current: authAll.filter((a) => a.current),
            all: authAll,
        },
        publicOfficials: officials,
        sanctionProceedings: sanctions,
        verificationDocuments: docs,
        noRelations: ubosAll.length === 0 && authAll.length === 0 && officials.length === 0 && sanctions.length === 0,
    };
}
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function optionalFiniteNumber(row, key) {
    return row[key] === undefined || (typeof row[key] === "number" && Number.isFinite(row[key]));
}
function optionalText(row, key) {
    return row[key] === undefined || row[key] === null || typeof row[key] === "string";
}
function optionalBoolean(row, key) {
    return row[key] === undefined || row[key] === null || typeof row[key] === "boolean";
}
function optionalNestedRecord(row, key, guard) {
    return row[key] === undefined || row[key] === null || guard(row[key]);
}
function isRawAddress(value) {
    if (!isRecord(value))
        return false;
    return ["MenoUlice", "OrientacneCislo", "SupisneCislo", "Mesto", "Psc"]
        .every((key) => optionalText(value, key));
}
function isRawState(value) {
    return isRecord(value) && optionalText(value, "Meno");
}
function hasText(row, keys) {
    return keys.some((key) => typeof row[key] === "string");
}
function isRawPartnerSummary(value) {
    if (!isRecord(value) || !optionalFiniteNumber(value, "Id"))
        return false;
    const textKeys = ["Meno", "Priezvisko", "TitulPred", "TitulZa", "ObchodneMeno", "Ico", "FormaOsoby", "PlatnostOd", "PlatnostDo"];
    return textKeys.every((key) => optionalText(value, key)) &&
        (typeof value.Id === "number" || hasText(value, ["Meno", "Priezvisko", "ObchodneMeno", "Ico"]));
}
function isRawUbo(value) {
    if (!isRecord(value) || !optionalFiniteNumber(value, "Id"))
        return false;
    const textKeys = ["Meno", "Priezvisko", "TitulPred", "TitulZa", "ObchodneMeno", "Ico", "DatumNarodenia", "PlatnostOd", "PlatnostDo"];
    return textKeys.every((key) => optionalText(value, key)) &&
        optionalBoolean(value, "JeVerejnyCinitel") &&
        optionalNestedRecord(value, "Adresa", isRawAddress) &&
        optionalNestedRecord(value, "StatnaPrislusnost", isRawState) &&
        (typeof value.Id === "number" || hasText(value, ["Meno", "Priezvisko", "ObchodneMeno", "Ico"]));
}
function isRawAuthorizedPerson(value) {
    if (!isRecord(value) || !optionalFiniteNumber(value, "Id"))
        return false;
    const textKeys = ["Meno", "Priezvisko", "ObchodneMeno", "Ico", "FormaOsoby", "PlatnostOd", "PlatnostDo"];
    return textKeys.every((key) => optionalText(value, key)) &&
        (typeof value.Id === "number" || hasText(value, ["Meno", "Priezvisko", "ObchodneMeno", "Ico"]));
}
function isRawPublicOfficial(value) {
    if (!isRecord(value) || !optionalFiniteNumber(value, "Id"))
        return false;
    const textKeys = ["Meno", "Priezvisko", "TitulPred", "TitulZa", "Funkcia", "PlatnostOd", "PlatnostDo"];
    return textKeys.every((key) => optionalText(value, key)) &&
        (typeof value.Id === "number" || hasText(value, ["Meno", "Priezvisko", "Funkcia"]));
}
function isRawSanction(value) {
    if (!isRecord(value) || !optionalFiniteNumber(value, "Id"))
        return false;
    const textKeys = ["DatumZacatiaKonania", "DatumSkonceniaKonania", "DatumPravoplatnostiRozhodnutia", "SposobRozhodnutiaKP", "SpisovaZnackaKonania"];
    return textKeys.every((key) => optionalText(value, key)) &&
        (typeof value.Id === "number" || hasText(value, textKeys));
}
function isRawVerificationDocument(value) {
    if (!isRecord(value) || !optionalFiniteNumber(value, "Id") || !optionalFiniteNumber(value, "CisloVlozky"))
        return false;
    return optionalText(value, "PlatnyOd") && optionalText(value, "PlatnyDo") &&
        (typeof value.Id === "number" || typeof value.CisloVlozky === "number");
}
function normalizeRelationRows(value, guard, normalize) {
    if (!Array.isArray(value))
        return [];
    return value.filter(guard).map(normalize);
}
/** Escape a single quote for an OData string literal ('' is the escape). */
export function odataQuote(value) {
    return `'${value.replace(/'/g, "''")}'`;
}
// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
export class RpvsClient {
    baseUrl;
    baseBoundary;
    requestOptions;
    debugLogs;
    constructor(options = {}) {
        // Deployment templates can pass an explicitly empty variable; treat that as
        // unset so URL construction remains deterministic.
        const base = options.baseUrl?.trim() || process.env.RPVS_BASE_URL?.trim() || DEFAULT_BASE_URL;
        this.baseBoundary = validateConfiguredBase(base);
        this.baseUrl = this.baseBoundary.href;
        this.debugLogs = options.debugLogs ?? isTruthy(process.env.RPVS_DEBUG_LOGS);
        this.requestOptions = {
            timeoutMs: options.timeoutMs ?? 15_000,
            maxRetries: options.maxRetries ?? 2,
            retryBaseDelayMs: options.retryBaseDelayMs ?? 400,
            maxPages: options.maxPages ?? 10,
        };
    }
    /**
     * rpvs_search — find public-sector partners by name or ICO.
     * NOTE: server $top is hard-disabled; we limit client-side and walk
     * @odata.nextLink (keyset pagination) only as far as needed.
     */
    async search(query, options = {}) {
        const limit = options.limit ?? 20;
        const by = options.by ?? "auto";
        const useIco = by === "ico" || (by === "auto" && (looksLikeIco(query) || looksLikeAmbiguousIco(query)));
        let filter;
        if (useIco) {
            filter = `Ico eq ${odataQuote(normalizeIco(query))}`;
        }
        else {
            const op = options.match === "startswith" ? "startswith" : "contains";
            filter = `${op}(ObchodneMeno,${odataQuote(query)})`;
        }
        const params = new URLSearchParams();
        params.set("$filter", filter);
        params.set("$select", "Id,Ico,ObchodneMeno,Meno,Priezvisko,TitulPred,TitulZa,FormaOsoby,PlatnostOd,PlatnostDo");
        // Fetch one row beyond the limit purely to learn whether more exist. The
        // caller otherwise sees exactly `limit` rows and cannot tell a complete
        // answer from a truncated one.
        const rows = await this.collect("PartneriVerejnehoSektora", params, limit + 1);
        return {
            results: rows.slice(0, limit).map(normalizePartnerSummary),
            truncated: rows.length > limit,
            limit,
        };
    }
    /**
     * rpvs_get_partner — full UBO chain + authorized persons + officials.
     * Recommended entry path: filter Partneri by the partner's ICO and expand
     * the navigation collections in one round-trip.
     */
    async getPartnerByIco(ico, includeVerifications = true) {
        const normalized = normalizeIco(ico);
        const params = new URLSearchParams();
        params.set("$filter", `PartneriVerejnehoSektora/any(p:p/Ico eq ${odataQuote(normalized)})`);
        params.set("$expand", PARTNER_EXPAND);
        const page = await this.requestJson("Partneri", params);
        const partner = page.value?.[0];
        if (!partner)
            return null;
        return this.finishPartner(partner, includeVerifications);
    }
    async getPartnerById(partnerId, includeVerifications = true) {
        const params = new URLSearchParams();
        params.set("$expand", PARTNER_EXPAND);
        const partner = await this.requestJson(`Partneri(${partnerId})`, params);
        if (!partner || partner.Id === undefined)
            return null;
        return this.finishPartner(partner, includeVerifications);
    }
    async finishPartner(partner, includeVerifications) {
        let docs = [];
        const cislo = partner.CisloVlozky ?? partner.Id;
        if (includeVerifications && cislo !== undefined) {
            try {
                docs = await this.getVerificationDocuments(cislo);
            }
            catch (error) {
                // Verification metadata is supplementary; never fail the whole lookup.
                this.log("verification_fetch_failed", { errorCode: "VERIFICATION_UNAVAILABLE" });
            }
        }
        return buildPartnerDetail(partner, docs);
    }
    /** Verification document metadata for a partner (binary `Data` omitted via $select). */
    async getVerificationDocuments(cisloVlozky) {
        const params = new URLSearchParams();
        params.set("$select", "Id,PlatnyOd,PlatnyDo,CisloVlozky");
        params.set("$filter", `CisloVlozky eq ${cisloVlozky}`);
        return this.collect("VerifikacneDokumenty", params, 100);
    }
    // -------------------------------------------------------------------------
    // Transport: paging walk + single request with retry
    // -------------------------------------------------------------------------
    /** Walk @odata.nextLink (keyset pagination) until `limit` rows or pages exhausted. */
    async collect(entitySet, params, limit) {
        const out = [];
        let url = this.buildUrl(entitySet, params);
        for (let page = 0; page < this.requestOptions.maxPages; page += 1) {
            const data = await this.requestJsonUrl(url);
            for (const row of data.value ?? []) {
                out.push(row);
                if (out.length >= limit)
                    return out;
            }
            const next = data["@odata.nextLink"];
            if (!next)
                break;
            url = this.resolvePaginationLink(next, url);
        }
        return out;
    }
    buildUrl(entitySet, params) {
        const url = new URL(entitySet, this.baseUrl);
        if (params)
            url.search = params.toString();
        return url;
    }
    requestJson(entitySet, params) {
        return this.requestJsonUrl(this.buildUrl(entitySet, params));
    }
    resolvePaginationLink(raw, current) {
        let next;
        try {
            next = new URL(raw, current);
        }
        catch {
            throw new Error("UNSAFE_PAGINATION_LINK: continuation URL is invalid.");
        }
        if (next.origin !== this.baseBoundary.origin || next.username || next.password || next.hash ||
            !isPathInside(next.pathname, this.baseBoundary.pathname) || isUnsafeHostname(next.hostname)) {
            throw new Error("UNSAFE_PAGINATION_LINK: continuation URL left the configured RPVS boundary.");
        }
        return next;
    }
    async requestJsonUrl(input) {
        const url = typeof input === "string" ? new URL(input) : input;
        const { timeoutMs, maxRetries, retryBaseDelayMs } = this.requestOptions;
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const startedAt = Date.now();
            this.log("request_start", { attempt: attempt + 1, maxAttempts: maxRetries + 1 });
            try {
                const response = await fetch(url, {
                    method: "GET",
                    redirect: "error",
                    headers: {
                        Accept: "application/json",
                        "User-Agent": "rpvs-mcp/0.2.0",
                    },
                    signal: controller.signal,
                });
                if (response.ok) {
                    this.log("request_success", {
                        status: response.status,
                        durationMs: Date.now() - startedAt,
                    });
                    return (await response.json());
                }
                const retriable = response.status === 408 || response.status === 429 || response.status >= 500;
                this.log("request_http_error", {
                    status: response.status,
                    durationMs: Date.now() - startedAt,
                    retriable: retriable && attempt < maxRetries,
                });
                if (attempt < maxRetries && retriable) {
                    await sleep(retryBaseDelayMs * 2 ** attempt);
                    continue;
                }
                throw new Error("UPSTREAM_HTTP_ERROR");
            }
            catch (error) {
                const isAbort = error instanceof DOMException && error.name === "AbortError";
                const isNetwork = error instanceof TypeError;
                const canRetry = attempt < maxRetries && (isAbort || isNetwork);
                this.log("request_exception", {
                    errorCode: isAbort ? "UPSTREAM_TIMEOUT" : isNetwork ? "UPSTREAM_NETWORK" : "UPSTREAM_ERROR",
                    durationMs: Date.now() - startedAt,
                    retriable: canRetry,
                });
                if (canRetry) {
                    await sleep(retryBaseDelayMs * 2 ** attempt);
                    continue;
                }
                throw error;
            }
            finally {
                clearTimeout(timer);
            }
        }
        throw new Error("RPVS request retry loop exhausted");
    }
    log(event, fields) {
        if (this.debugLogs)
            safeLogEvent(event, fields);
    }
}
function validateConfiguredBase(raw) {
    let parsed;
    try {
        parsed = new URL(raw.endsWith("/") ? raw : `${raw}/`);
    }
    catch {
        throw new Error("UNSAFE_UPSTREAM_BASE: RPVS_BASE_URL must be an absolute HTTPS URL.");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash ||
        isUnsafeHostname(parsed.hostname)) {
        throw new Error("UNSAFE_UPSTREAM_BASE: RPVS_BASE_URL must be a public HTTPS origin without credentials, query, or fragment.");
    }
    return parsed;
}
function isPathInside(pathname, basePathname) {
    const basePath = basePathname.endsWith("/") ? basePathname : `${basePathname}/`;
    return pathname === basePath.slice(0, -1) || pathname.startsWith(basePath);
}
function isUnsafeHostname(hostname) {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local"))
        return true;
    const version = isIP(host);
    if (version === 4) {
        const [a, b] = host.split(".").map(Number);
        return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
    }
    if (version === 6) {
        return host === "::" || host === "::1" || host.startsWith("::ffff:") ||
            host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") ||
            host.startsWith("feb") || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("ff");
    }
    return false;
}
// Single-round-trip expand for rpvs_get_partner.
const PARTNER_EXPAND = "PartneriVerejnehoSektora($expand=Adresa,PravnaForma)," +
    "KonecniUzivateliaVyhod($expand=Adresa,StatnaPrislusnost)," +
    "OpravneneOsoby,VerejniFunkcionari,KvalifikovanePodnety";
// ---------------------------------------------------------------------------
// Misc utilities
// ---------------------------------------------------------------------------
function isTruthy(value) {
    return /^(1|true|yes|on)$/i.test(value ?? "");
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
