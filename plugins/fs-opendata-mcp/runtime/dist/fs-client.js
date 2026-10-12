import { dataPageResponseSchema, SLUG_CORPORATE_INCOME_TAX, SLUG_INCOME_TAX_REGISTRATION, SLUG_TAX_DEBTORS, SLUG_TAX_RELIABILITY_INDEX, SLUG_VAT_CANCELLED, SLUG_VAT_DELETED, SLUG_VAT_IBAN, SLUG_VAT_REGISTERED, SLUG_VAT_TAX_ADMIN_ACCOUNT, } from "./types.js";
const DEFAULT_FS_BASE_URL = "https://iz.opendata.financnasprava.sk/api";
const SOURCE = "Finančná správa SR Information Lists API";
export const MAX_PAGES = 20;
export const MAX_ROWS = 2_000;
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const MAX_METADATA_ROWS = 500;
const LISTS_TTL_MS = 60 * 60 * 1000;
const MIN_SEARCH_LENGTH = 5;
const MAX_DEBTOR_SEARCHES = 6;
export class FsSourceError extends Error {
    code;
    name = "FsSourceError";
    constructor(code, message) {
        super(message);
        this.code = code;
    }
    toJSON() { return { code: this.code, message: this.message }; }
}
export function resolveFsBaseUrl(env = process.env) {
    return (env.FS_BASE_URL?.trim() || DEFAULT_FS_BASE_URL).replace(/\/+$/, "");
}
export function normalizeIco(value) {
    if (typeof value !== "string")
        return null;
    const match = /^[ \t\r\n]*([0-9]{8})[ \t\r\n]*$/.exec(value);
    return match?.[1] ?? null;
}
export function normalizeIcDph(value) {
    if (typeof value !== "string")
        return null;
    const match = /^[ \t\r\n]*SK([0-9]{10})[ \t\r\n]*$/i.exec(value);
    return match ? `SK${match[1]}` : null;
}
export function parseDataPage(payload) {
    const parsed = dataPageResponseSchema.safeParse(payload);
    if (!parsed.success)
        throw new FsSourceError("FS_SCHEMA", "FS source returned an invalid response envelope.");
    const result = parsed.data;
    if (result.page > result.pages || result.data.length > result.itemsCount || (result.itemsCount === 0 && result.data.length !== 0)) {
        throw new FsSourceError("FS_TOTAL", "FS source returned contradictory pagination totals.");
    }
    return result;
}
function text(row, key) {
    const value = row[key];
    if (value === undefined || value === null)
        return null;
    const normalized = String(value).trim();
    return normalized || null;
}
function composeAddress(row) {
    return [text(row, "ulica_cislo") ?? text(row, "adresa"), text(row, "psc"), text(row, "obec"), text(row, "stat")].filter(Boolean).join(", ") || null;
}
export function normalizeVatRecord(row) {
    const record = { icDph: text(row, "ic_dph"), ico: text(row, "ico"), name: text(row, "nazov_ds") ?? text(row, "nazov"), address: composeAddress(row), registrationDate: text(row, "datum_reg"), registrationType: text(row, "druh_reg_dph") };
    // ds_dphz / ds_dphv carry why and when the row was published; keep it instead of dropping it.
    for (const [key, column] of [["violationYear", "rok_porusenia"], ["publicationDate", "dat_zverejnenia"], ["deletionDate", "dat_vymazu"]]) {
        const value = text(row, column);
        if (value)
            record[key] = value;
    }
    return record;
}
/** ds_dsdd publishes ciastka (arrears total) and address parts; it has no IČO and no tax-type column. */
export function normalizeDebtorRecord(row) {
    return { ico: text(row, "ico"), name: text(row, "nazov_subjektu") ?? text(row, "nazov_ds") ?? text(row, "nazov"), address: composeAddress(row), arrearsAmount: text(row, "ciastka"), taxType: null };
}
/**
 * Drop only true duplicates: the same source row id, or an identical row without one.
 * Keying on chosen columns merged distinct rows whenever a key column did not exist
 * (cislo_uctu instead of iban collapsed every account of one IČ DPH into one).
 */
function rowKey(row) {
    if (row.id !== undefined && row.id !== null && String(row.id).trim())
        return `id:${String(row.id)}`;
    return JSON.stringify(Object.keys(row).sort().map((key) => [key, row[key]]));
}
function dedupe(rows) {
    const seen = new Set();
    return rows.filter((row) => { const key = rowKey(row); if (seen.has(key))
        return false; seen.add(key); return true; });
}
const LEGAL_FORM_SUFFIX = /^(.+?)\s*,?\s+(s\.\s?r\.\s?o\.|spol\.\s*s\s*r\.\s?o\.|a\.\s?s\.|k\.\s?s\.|v\.\s?o\.\s?s\.|j\.\s?s\.\s?a\.|s\.\s?e\.|družstvo)$/iu;
/**
 * ds_dsdd matches the whole name only (case-insensitive, whitespace-sensitive):
 * "Example s.r.o." misses "Example, s.r.o.". Send each name plus its with/without-comma
 * spelling before a legal-form suffix.
 */
export function debtorNameVariants(names) {
    const out = [];
    const seen = new Set();
    const push = (value) => { const key = value.toLocaleLowerCase("sk"); if (value.length < MIN_SEARCH_LENGTH || seen.has(key))
        return; seen.add(key); out.push(value); };
    for (const name of names) {
        const base = name.replace(/\s+/g, " ").trim();
        push(base);
        const match = LEGAL_FORM_SUFFIX.exec(base);
        if (match) {
            push(`${match[1]}, ${match[2]}`);
            push(`${match[1]} ${match[2]}`);
        }
    }
    return out.slice(0, MAX_DEBTOR_SEARCHES);
}
function combineValidity(datasetKey, pages, returnedCount) {
    const truncated = pages.some((entry) => entry.validity.truncated);
    return { source: SOURCE, datasetKey, retrievedAt: new Date().toISOString(), sourceValidated: true, page: Math.max(...pages.map((entry) => entry.validity.page)), pageSize: Math.max(...pages.map((entry) => entry.validity.pageSize)), sourceTotal: pages.reduce((sum, entry) => sum + entry.validity.sourceTotal, 0), returnedCount, truncated, truncationReason: pages.find((entry) => entry.validity.truncationReason)?.validity.truncationReason ?? null, warnings: pages.flatMap((entry) => entry.validity.warnings) };
}
function mergeAggregatedPages(datasetKey, pages) {
    const all = dedupe(pages.flatMap((entry) => entry.data));
    const data = all.slice(0, MAX_ROWS);
    const validity = combineValidity(datasetKey, pages, data.length);
    if (all.length > MAX_ROWS) {
        validity.truncated = true;
        validity.truncationReason = "MAX_ROWS";
        if (!validity.warnings.includes("Result was truncated by a configured safety limit."))
            validity.warnings.push("Result was truncated by a configured safety limit.");
    }
    return { data, validity };
}
export function buildVatStatusResult(_query, registeredPage, deletedPage, cancelledPage, unverifiedLists = []) {
    const wrap = (datasetKey, value) => ({ data: value.data, validity: { source: SOURCE, datasetKey, retrievedAt: new Date().toISOString(), sourceValidated: true, page: value.page, pageSize: value.itemsPerPage, sourceTotal: value.itemsCount, returnedCount: value.data.length, truncated: false, truncationReason: null, warnings: [] } });
    return buildVatResult(wrap(SLUG_VAT_REGISTERED, registeredPage), deletedPage ? wrap(SLUG_VAT_DELETED, deletedPage) : null, wrap(SLUG_VAT_CANCELLED, cancelledPage), unverifiedLists);
}
/**
 * ds_dphv (deleted) and ds_dphz (grounds for cancellation arose, payer still registered)
 * are reported separately. A null deleted page means ds_dphv was not queried.
 */
function buildVatResult(registeredPage, deletedPage, cancelledPage, unverifiedLists) {
    const registeredRows = dedupe(registeredPage.data);
    const deletedRows = deletedPage ? dedupe(deletedPage.data) : [];
    const groundsRows = dedupe(cancelledPage.data);
    const registered = registeredRows.slice(0, MAX_ROWS);
    const deregistered = deletedRows.slice(0, Math.max(0, MAX_ROWS - registered.length));
    const grounds = groundsRows.slice(0, Math.max(0, MAX_ROWS - registered.length - deregistered.length));
    const aggregateTruncated = registeredRows.length + deletedRows.length + groundsRows.length > MAX_ROWS;
    const pages = deletedPage ? [registeredPage, deletedPage, cancelledPage] : [registeredPage, cancelledPage];
    const validity = combineValidity("ds_dphs+ds_dphv+ds_dphz", pages, registered.length + deregistered.length + grounds.length);
    if (aggregateTruncated) {
        validity.truncated = true;
        validity.truncationReason = "MAX_ROWS";
        if (!validity.warnings.includes("Result was truncated by a configured safety limit."))
            validity.warnings.push("Result was truncated by a configured safety limit.");
    }
    const notes = [];
    if (!registeredRows.length)
        notes.push("V zozname subjektov registrovaných k DPH (ds_dphs) sa nenašiel záznam.");
    if (groundsRows.length)
        notes.push("Subjekt je v zozname platiteľov DPH, u ktorých nastali dôvody na zrušenie registrácie (ds_dphz); nejde o zrušenú registráciu.");
    if (deletedRows.length && registeredRows.length)
        notes.push("Subjekt je v zozname registrovaných aj vymazaných (ds_dphv); porovnaj deletionDate.");
    for (const entry of unverifiedLists)
        notes.push(`NEOVERENÉ ${entry.slug}: ${entry.reason}`);
    return { isVatPayer: registeredRows.length > 0, isDeregistered: deletedPage ? deletedRows.length > 0 : null, registered: registered.map(normalizeVatRecord), deregistered: deregistered.map(normalizeVatRecord), cancellationGroundsPublished: groundsRows.length > 0, cancellationGrounds: grounds.map(normalizeVatRecord), unverifiedLists, reliabilityIndex: null, reliabilityNote: "Index daňovej spoľahlivosti je v samostatnom zozname ds_iz_ran.", validity, note: notes.length ? notes.join(" ") : undefined };
}
const DEBTOR_LIMITATION = "Zoznam daňových dlžníkov (ds_dsdd) sa dá prehľadať iba presnou zhodou celého názvu a neobsahuje IČO; podľa FS obsahuje subjekty s nedoplatkami nad 170 eur k poslednému dňu mesiaca.";
export function buildTaxDebtorResult(_query, page, searchedNames = []) {
    const rows = dedupe(page.data);
    return { searchedNames, isDebtor: rows.length > 0, matchCount: rows.length, records: rows.map(normalizeDebtorRecord), validity: { source: SOURCE, datasetKey: SLUG_TAX_DEBTORS, retrievedAt: new Date().toISOString(), sourceValidated: true, page: page.page, pageSize: page.itemsPerPage, sourceTotal: page.itemsCount, returnedCount: rows.length, truncated: false, truncationReason: null, warnings: [] }, note: debtorNote(rows.length) };
}
function debtorNote(found) {
    return found
        ? `Zhoda iba podľa názvu — zoznam neobsahuje IČO, over adresu (menovci sú možní). ${DEBTOR_LIMITATION}`
        : `Presné názvy v searchedNames sa v zozname nenašli. ${DEBTOR_LIMITATION} Nie je to potvrdenie, že subjekt nemá nedoplatky.`;
}
export function buildDatasetLookupResult(_query, slug, page, emptyNote) {
    return { slug, matchCount: page.data.length, records: page.data, validity: { source: SOURCE, datasetKey: slug, retrievedAt: new Date().toISOString(), sourceValidated: true, page: page.page, pageSize: page.itemsPerPage, sourceTotal: page.itemsCount, returnedCount: page.data.length, truncated: false, truncationReason: null, warnings: [] }, note: page.data.length ? undefined : emptyNote };
}
class Semaphore {
    active = 0;
    queue = [];
    async run(action) { if (this.active >= 4)
        await new Promise((resolve) => this.queue.push(resolve)); this.active += 1; try {
        return await action();
    }
    finally {
        this.active -= 1;
        this.queue.shift()?.();
    } }
}
export class FsClient {
    timeoutMs;
    maxRetries;
    retryBaseDelayMs;
    apiKey;
    baseUrl;
    upstream = new Semaphore();
    constructor(options = {}) { this.timeoutMs = options.timeoutMs ?? 15_000; this.maxRetries = options.maxRetries ?? 2; this.retryBaseDelayMs = options.retryBaseDelayMs ?? 400; this.apiKey = options.apiKey ?? process.env.FS_API_KEY?.trim() ?? ""; this.baseUrl = options.baseUrl ?? resolveFsBaseUrl(); }
    async getVatStatus(input) {
        const icDph = normalizeIcDph(input.icDph);
        const ico = normalizeIco(input.ico);
        if (!icDph && !ico)
            throw new FsSourceError("FS_INPUT", "A valid IČ DPH or IČO is required.");
        if (input.icDph !== undefined && !icDph)
            throw new FsSourceError("FS_INPUT", "IČ DPH must be SK followed by ten ASCII digits.");
        if (input.ico !== undefined && !ico)
            throw new FsSourceError("FS_INPUT", "IČO must contain exactly eight ASCII digits.");
        if (icDph) {
            const [registered, deleted, cancelled] = await Promise.all([
                this.searchDataset(SLUG_VAT_REGISTERED, "ic_dph", icDph),
                this.searchDataset(SLUG_VAT_DELETED, "ic_dph", icDph),
                this.searchDataset(SLUG_VAT_CANCELLED, "ic_dph", icDph),
            ]);
            return this.withListDates(buildVatResult(registered, deleted, cancelled, []), [SLUG_VAT_REGISTERED, SLUG_VAT_DELETED, SLUG_VAT_CANCELLED]);
        }
        const [registered, cancelled] = await Promise.all([
            this.searchDataset(SLUG_VAT_REGISTERED, "ico", ico),
            this.searchDataset(SLUG_VAT_CANCELLED, "ico", ico),
        ]);
        const vatIdsOf = (rows, read) => [...new Set(rows.map((row) => normalizeIcDph(read(row))).filter((value) => value !== null))];
        let vatIds = vatIdsOf([...registered.data, ...cancelled.data], (row) => text(row, "ic_dph"));
        // ds_dphv is searchable only by ic_dph. A payer deleted earlier is in neither ds_dphs nor
        // ds_dphz; most IČ DPH are SK + DIČ, and ds_dsrdp publishes the DIČ per IČO.
        if (!vatIds.length) {
            const income = await this.searchDataset(SLUG_INCOME_TAX_REGISTRATION, "ico", ico);
            vatIds = vatIdsOf(income.data, (row) => (text(row, "dic") ? `SK${text(row, "dic")}` : null));
        }
        if (!vatIds.length) {
            // Not an error: a subject that is not a VAT payer is a legitimate answer. Say what was not checked.
            return this.withListDates(buildVatResult(registered, null, cancelled, [{ slug: SLUG_VAT_DELETED, reason: "ds_dphv sa dá prehľadať iba podľa IČ DPH a pre toto IČO sa IČ DPH nezistilo (nie je v ds_dphs, ds_dphz ani DIČ v ds_dsrdp). Ak IČ DPH poznáš, zadaj icDph." }]), [SLUG_VAT_REGISTERED, SLUG_VAT_DELETED, SLUG_VAT_CANCELLED]);
        }
        const merged = mergeAggregatedPages(SLUG_VAT_DELETED, await Promise.all(vatIds.map((value) => this.searchDataset(SLUG_VAT_DELETED, "ic_dph", value))));
        // A VAT group shares one IČ DPH — keep only this subject's rows.
        const deleted = { ...merged, data: merged.data.filter((row) => { const rowIco = normalizeIco(text(row, "ico") ?? undefined); return rowIco === null || rowIco === ico; }) };
        return this.withListDates(buildVatResult(registered, deleted, cancelled, []), [SLUG_VAT_REGISTERED, SLUG_VAT_DELETED, SLUG_VAT_CANCELLED]);
    }
    /**
     * ds_dsdd is searchable only by the exact full name and has no IČO column. With IČO alone the
     * name is resolved from ds_dsrdp / ds_dphs / ds_iz_ran first; the match is still name-only.
     */
    async checkTaxDebtor(input) {
        const ico = input.ico === undefined ? null : normalizeIco(input.ico);
        if (input.ico !== undefined && !ico)
            throw new FsSourceError("FS_INPUT", "IČO must contain exactly eight ASCII digits.");
        const name = input.name?.trim();
        const names = name ? [name] : ico ? await this.namesByIco(ico) : [];
        if (!names.length)
            throw new FsSourceError("FS_INPUT", ico ? "No subject name was found for this IČO; ds_dsdd is searchable by name only." : "A subject name or IČO is required for ds_dsdd.");
        const searches = debtorNameVariants(names);
        if (!searches.length)
            throw new FsSourceError("FS_INPUT", "ds_dsdd requires at least five characters of the subject name.");
        const pages = await Promise.all(searches.map((value) => this.searchDataset(SLUG_TAX_DEBTORS, "nazov_subjektu", value)));
        const merged = mergeAggregatedPages(SLUG_TAX_DEBTORS, pages);
        return this.withListDates({ searchedNames: searches, isDebtor: merged.data.length > 0, matchCount: merged.data.length, records: merged.data.map(normalizeDebtorRecord), validity: merged.validity, note: debtorNote(merged.data.length) }, [SLUG_TAX_DEBTORS]);
    }
    async getVatBankAccounts(input) { return this.lookupIcDph(input.icDph, SLUG_VAT_IBAN); }
    async getVatTaxAdminAccount(input) { return this.lookupIcDph(input.icDph, SLUG_VAT_TAX_ADMIN_ACCOUNT); }
    async getTaxReliabilityIndex(input) { return this.lookupIco(input.ico, SLUG_TAX_RELIABILITY_INDEX); }
    async getCorporateIncomeTax(input) { return this.lookupIco(input.ico, SLUG_CORPORATE_INCOME_TAX); }
    async getIncomeTaxRegistration(input) { return this.lookupIco(input.ico, SLUG_INCOME_TAX_REGISTRATION); }
    async lookupIcDph(value, slug) {
        const icDph = normalizeIcDph(value);
        if (!icDph)
            throw new FsSourceError("FS_INPUT", "IČ DPH must be SK followed by ten ASCII digits.");
        return this.lookup(slug, "ic_dph", icDph);
    }
    async lookupIco(value, slug) {
        const ico = normalizeIco(value);
        if (!ico)
            throw new FsSourceError("FS_INPUT", "IČO must contain exactly eight ASCII digits.");
        return this.lookup(slug, "ico", ico);
    }
    async lookup(slug, column, search) {
        const result = await this.searchDataset(slug, column, search);
        return this.withListDates({ slug, matchCount: result.data.length, records: result.data, validity: result.validity, note: result.data.length ? undefined : "V overenom zozname sa nenašiel záznam (dátum zoznamu vo validity.listUpdateDates)." }, [slug]);
    }
    async namesByIco(ico) {
        const sources = [[SLUG_INCOME_TAX_REGISTRATION, "nazov_ds"], [SLUG_VAT_REGISTERED, "nazov_ds"], [SLUG_TAX_RELIABILITY_INDEX, "nazov_subjektu"]];
        const pages = await Promise.all(sources.map(([slug]) => this.searchDataset(slug, "ico", ico)));
        const names = [];
        pages.forEach((page, index) => { for (const row of page.data) {
            const value = text(row, sources[index][1]);
            if (value && !names.some((entry) => entry.toLocaleLowerCase("sk") === value.toLocaleLowerCase("sk")))
                names.push(value);
        } });
        return names;
    }
    /** Attach update_date from /lists (cached an hour); a failing catalogue leaves null dates, never fails the lookup. */
    async withListDates(result, slugs) {
        const catalogue = await this.catalogue();
        result.validity.listUpdateDates = Object.fromEntries(slugs.map((slug) => [slug, catalogue?.get(slug)?.updateDate ?? null]));
        return result;
    }
    catalogueCache = null;
    catalogueInFlight = null;
    async catalogue() {
        if (this.catalogueCache && Date.now() - this.catalogueCache.at < LISTS_TTL_MS)
            return this.catalogueCache.bySlug;
        this.catalogueInFlight ??= this.listDatasets()
            .then(({ records }) => { this.catalogueCache = { at: Date.now(), bySlug: new Map(records.map((entry) => [entry.slug, entry])) }; return this.catalogueCache.bySlug; })
            .catch(() => null)
            .finally(() => { this.catalogueInFlight = null; });
        return this.catalogueInFlight;
    }
    async searchDataset(slug, column, search) {
        const rows = [];
        let expectedTotal;
        let expectedPages;
        let last;
        let truncated = null;
        for (let current = 1; current <= MAX_PAGES; current += 1) {
            const params = new URLSearchParams({ column, search, page: String(current) });
            const parsed = parseDataPage(await this.requestJson(`/data/${encodeURIComponent(slug)}/search`, params, current === 1));
            if (parsed.page !== current)
                throw new FsSourceError("FS_TOTAL", "FS source changed the requested page number.");
            if (expectedTotal === undefined) {
                expectedTotal = parsed.itemsCount;
                expectedPages = parsed.pages;
            }
            if (parsed.itemsCount !== expectedTotal || parsed.pages !== expectedPages)
                throw new FsSourceError("FS_TOTAL", "FS source changed pagination totals.");
            rows.push(...parsed.data);
            last = parsed;
            if (rows.length >= MAX_ROWS) {
                if (rows.length > MAX_ROWS || current < parsed.pages || expectedTotal > MAX_ROWS)
                    truncated = "MAX_ROWS";
                break;
            }
            if (current >= parsed.pages)
                break;
            if (current === MAX_PAGES)
                truncated = "MAX_PAGES";
        }
        if (!last || expectedTotal === undefined)
            throw new FsSourceError("FS_SCHEMA", "FS source returned no validated page.");
        if (!truncated && rows.length !== expectedTotal)
            throw new FsSourceError("FS_TOTAL", "FS source totals do not match returned rows.");
        const unique = dedupe(rows.slice(0, MAX_ROWS));
        return { data: unique, validity: { source: SOURCE, datasetKey: slug, retrievedAt: new Date().toISOString(), sourceValidated: true, page: last.page, pageSize: last.itemsPerPage, sourceTotal: expectedTotal, returnedCount: unique.length, truncated: truncated !== null, truncationReason: truncated, warnings: truncated ? ["Result was truncated by a configured safety limit."] : [] } };
    }
    async listDatasets() {
        const payload = await this.requestJson("/lists");
        const entries = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray(payload.data) ? payload.data : null;
        if (!entries)
            throw new FsSourceError("FS_SCHEMA", "FS metadata response is invalid.");
        const all = entries.map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry))
                throw new FsSourceError("FS_SCHEMA", "FS metadata contains an invalid row.");
            const candidate = entry;
            if (typeof candidate.slug !== "string" || !candidate.slug.trim())
                throw new FsSourceError("FS_SCHEMA", "FS metadata contains an invalid row.");
            if (candidate.name !== undefined && typeof candidate.name !== "string")
                throw new FsSourceError("FS_SCHEMA", "FS metadata contains an invalid row.");
            if (candidate.columns !== undefined && (!Array.isArray(candidate.columns) || candidate.columns.some((column) => typeof column !== "string")))
                throw new FsSourceError("FS_SCHEMA", "FS metadata contains an invalid row.");
            if (candidate.searchable !== undefined && typeof candidate.searchable !== "string")
                throw new FsSourceError("FS_SCHEMA", "FS metadata contains an invalid row.");
            if (candidate.url !== undefined && typeof candidate.url !== "string" || candidate.update_date !== undefined && typeof candidate.update_date !== "string")
                throw new FsSourceError("FS_SCHEMA", "FS metadata contains an invalid row.");
            const columns = candidate.columns ?? candidate.searchable?.split(",").map((value) => value.trim()).filter(Boolean);
            return { slug: candidate.slug.trim(), ...(candidate.name !== undefined ? { name: candidate.name } : {}), ...(columns !== undefined ? { columns } : {}), ...(candidate.url !== undefined ? { url: candidate.url } : {}), ...(candidate.update_date !== undefined ? { updateDate: candidate.update_date } : {}) };
        });
        const seen = new Set();
        const records = all.filter((entry) => { if (seen.has(entry.slug))
            return false; seen.add(entry.slug); return true; }).slice(0, MAX_METADATA_ROWS);
        const truncated = all.length > MAX_METADATA_ROWS;
        return { records, validity: { source: SOURCE, datasetKey: "/lists", retrievedAt: new Date().toISOString(), sourceValidated: true, page: 1, pageSize: MAX_METADATA_ROWS, sourceTotal: all.length, returnedCount: records.length, truncated, truncationReason: truncated ? "MAX_METADATA_ROWS" : null, warnings: truncated ? ["Metadata result was truncated."] : [] } };
    }
    async requestJson(path, params, allowExactSearchMiss = false) {
        return this.upstream.run(async () => {
            for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), this.timeoutMs);
                try {
                    const url = new URL(this.baseUrl + path);
                    if (params)
                        url.search = params.toString();
                    const headers = { Accept: "application/json", "User-Agent": "fs-opendata-mcp/0.2.1" };
                    if (this.apiKey)
                        headers.key = this.apiKey;
                    const response = await fetch(url, { method: "GET", headers, signal: controller.signal, redirect: "manual" });
                    if (response.status >= 300 && response.status < 400)
                        throw new FsSourceError("FS_REDIRECT", "FS source redirects are not accepted.");
                    const exactSearchMissCandidate = response.status === 404 && allowExactSearchMiss && params?.get("page") === "1" && /^\/data\/(?:ds_dphs|ds_dphv|ds_dphz|ds_dsdd|ds_dph_oud|ds_dph_iban|ds_dpho|ds_dppos|ds_dsrdp|ds_iz_ran)\/search$/.test(path);
                    if (response.status === 401 || response.status === 403)
                        throw new FsSourceError("FS_AUTH", "FS source rejected the API key.");
                    if (response.status !== 200 && !exactSearchMissCandidate)
                        throw new FsSourceError("FS_HTTP", "FS source returned a non-success status.");
                    if (!/^(application\/(?:json|[^;]+\+json))(?:;|$)/i.test(response.headers.get("content-type") ?? ""))
                        throw new FsSourceError("FS_CONTENT_TYPE", "FS source did not return JSON.");
                    const declaredLength = response.headers.get("content-length");
                    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES)
                        throw new FsSourceError("FS_UPSTREAM", "FS source page exceeded the response limit.");
                    const chunks = [];
                    let bodyLength = 0;
                    if (response.body) {
                        const reader = response.body.getReader();
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done)
                                break;
                            bodyLength += value.byteLength;
                            if (bodyLength > MAX_RESPONSE_BYTES) {
                                await reader.cancel();
                                throw new FsSourceError("FS_UPSTREAM", "FS source page exceeded the response limit.");
                            }
                            chunks.push(value);
                        }
                    }
                    else {
                        const fallback = new Uint8Array(await response.arrayBuffer());
                        bodyLength = fallback.byteLength;
                        if (bodyLength > MAX_RESPONSE_BYTES)
                            throw new FsSourceError("FS_UPSTREAM", "FS source page exceeded the response limit.");
                        chunks.push(fallback);
                    }
                    const body = new Uint8Array(bodyLength);
                    let offset = 0;
                    for (const chunk of chunks) {
                        body.set(chunk, offset);
                        offset += chunk.byteLength;
                    }
                    let payload;
                    try {
                        payload = JSON.parse(new TextDecoder().decode(body));
                    }
                    catch {
                        throw new FsSourceError(exactSearchMissCandidate ? "FS_HTTP" : "FS_PARSE", exactSearchMissCandidate ? "FS source returned a non-success status." : "FS source returned invalid JSON.");
                    }
                    if (exactSearchMissCandidate) {
                        const miss = payload;
                        if (!miss || typeof miss !== "object" || Array.isArray(miss) || Object.keys(miss).sort().join(",") !== "code,message,status" || miss.status !== "error" || miss.code !== "404" || miss.message !== "Page doesn't exists")
                            throw new FsSourceError("FS_HTTP", "FS source returned a non-success status.");
                        return { page: 1, pages: 1, itemsCount: 0, itemsPerPage: 0, data: [] };
                    }
                    return payload;
                }
                catch (error) {
                    const timeout = error instanceof DOMException && error.name === "AbortError";
                    if ((timeout || error instanceof TypeError) && attempt < this.maxRetries) {
                        await new Promise((resolve) => setTimeout(resolve, this.retryBaseDelayMs * 2 ** attempt));
                        continue;
                    }
                    if (error instanceof FsSourceError)
                        throw error;
                    if (timeout)
                        throw new FsSourceError("FS_TIMEOUT", "FS source request timed out.");
                    throw new FsSourceError("FS_UPSTREAM", "FS source request failed.");
                }
                finally {
                    clearTimeout(timer);
                }
            }
            throw new FsSourceError("FS_UPSTREAM", "FS source request failed.");
        });
    }
}
