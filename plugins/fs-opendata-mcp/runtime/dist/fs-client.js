import { dataPageResponseSchema, SLUG_CORPORATE_INCOME_TAX, SLUG_INCOME_TAX_REGISTRATION, SLUG_TAX_DEBTORS, SLUG_TAX_RELIABILITY_INDEX, SLUG_VAT_CANCELLED, SLUG_VAT_DELETED, SLUG_VAT_IBAN, SLUG_VAT_REGISTERED, SLUG_VAT_TAX_ADMIN_ACCOUNT, } from "./types.js";
const DEFAULT_FS_BASE_URL = "https://iz.opendata.financnasprava.sk/api";
const SOURCE = "Finančná správa SR Information Lists API";
export const MAX_PAGES = 20;
export const MAX_ROWS = 2_000;
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const MAX_METADATA_ROWS = 500;
const VAT_DEDUPE_KEYS = ["ic_dph", "ico", "nazov_ds", "datum_registracie", "datum_reg", "typ_registracie", "druh_reg_dph"];
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
export function normalizeVatRecord(row) {
    const address = text(row, "adresa") ?? ([text(row, "ulica_cislo"), text(row, "psc"), text(row, "obec"), text(row, "stat")].filter(Boolean).join(", ") || null);
    return { icDph: text(row, "ic_dph"), ico: text(row, "ico"), name: text(row, "nazov_ds") ?? text(row, "nazov"), address, registrationDate: text(row, "datum_registracie") ?? text(row, "datum_reg"), registrationType: text(row, "typ_registracie") ?? text(row, "druh_reg_dph") };
}
export function normalizeDebtorRecord(row) {
    return { ico: text(row, "ico"), name: text(row, "nazov_subjektu") ?? text(row, "nazov_ds") ?? text(row, "nazov"), address: text(row, "adresa"), arrearsAmount: text(row, "suma_nedoplatku"), taxType: text(row, "druh_dane") };
}
function stableKey(row, keys) { return keys.map((key) => String(row[key] ?? "")).join("\u0000"); }
function dedupe(rows, keys) {
    const seen = new Set();
    return rows.filter((row) => { const key = stableKey(row, keys); if (seen.has(key))
        return false; seen.add(key); return true; });
}
function combineValidity(datasetKey, pages, returnedCount) {
    const truncated = pages.some((entry) => entry.validity.truncated);
    return { source: SOURCE, datasetKey, retrievedAt: new Date().toISOString(), sourceValidated: true, page: Math.max(...pages.map((entry) => entry.validity.page)), pageSize: Math.max(...pages.map((entry) => entry.validity.pageSize)), sourceTotal: pages.reduce((sum, entry) => sum + entry.validity.sourceTotal, 0), returnedCount, truncated, truncationReason: pages.find((entry) => entry.validity.truncationReason)?.validity.truncationReason ?? null, warnings: pages.flatMap((entry) => entry.validity.warnings) };
}
function mergeAggregatedPages(datasetKey, pages, keys) {
    const all = dedupe(pages.flatMap((entry) => entry.data), keys);
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
export function buildVatStatusResult(_query, registeredPage, deletedPage, cancelledPage) {
    const wrap = (datasetKey, value) => ({ data: value.data, validity: { source: SOURCE, datasetKey, retrievedAt: new Date().toISOString(), sourceValidated: true, page: value.page, pageSize: value.itemsPerPage, sourceTotal: value.itemsCount, returnedCount: value.data.length, truncated: false, truncationReason: null, warnings: [] } });
    return buildVatResult(wrap(SLUG_VAT_REGISTERED, registeredPage), wrap(SLUG_VAT_DELETED, deletedPage), wrap(SLUG_VAT_CANCELLED, cancelledPage));
}
function buildVatResult(registeredPage, deletedPage, cancelledPage) {
    const registeredRows = dedupe(registeredPage.data, VAT_DEDUPE_KEYS);
    const deregisteredRows = dedupe([...deletedPage.data, ...cancelledPage.data], VAT_DEDUPE_KEYS);
    const registered = registeredRows.slice(0, MAX_ROWS);
    const deregistered = deregisteredRows.slice(0, Math.max(0, MAX_ROWS - registered.length));
    const aggregateTruncated = registeredRows.length + deregisteredRows.length > MAX_ROWS;
    const validity = combineValidity("ds_dphs+ds_dphv+ds_dphz", [registeredPage, deletedPage, cancelledPage], registered.length + deregistered.length);
    if (aggregateTruncated) {
        validity.truncated = true;
        validity.truncationReason = "MAX_ROWS";
        if (!validity.warnings.includes("Result was truncated by a configured safety limit."))
            validity.warnings.push("Result was truncated by a configured safety limit.");
    }
    return { isVatPayer: registeredRows.length > 0, isDeregistered: deregisteredRows.length > 0, registered: registered.map(normalizeVatRecord), deregistered: deregistered.map(normalizeVatRecord), reliabilityIndex: null, reliabilityNote: "Index daňovej spoľahlivosti je v samostatnom zozname ds_iz_ran.", validity, note: registeredRows.length || deregisteredRows.length ? undefined : "V overených zoznamoch sa nenašiel záznam." };
}
export function buildTaxDebtorResult(_query, page) {
    const rows = dedupe(page.data, ["ico", "nazov_subjektu", "adresa"]);
    return { isDebtor: rows.length > 0, matchCount: rows.length, records: rows.map(normalizeDebtorRecord), validity: { source: SOURCE, datasetKey: SLUG_TAX_DEBTORS, retrievedAt: new Date().toISOString(), sourceValidated: true, page: page.page, pageSize: page.itemsPerPage, sourceTotal: page.itemsCount, returnedCount: rows.length, truncated: false, truncationReason: null, warnings: [] }, note: rows.length ? undefined : "V overenom zozname sa nenašiel záznam." };
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
                this.searchDataset(SLUG_VAT_REGISTERED, "ic_dph", icDph, VAT_DEDUPE_KEYS),
                this.searchDataset(SLUG_VAT_DELETED, "ic_dph", icDph, VAT_DEDUPE_KEYS),
                this.searchDataset(SLUG_VAT_CANCELLED, "ic_dph", icDph, VAT_DEDUPE_KEYS),
            ]);
            return buildVatResult(registered, deleted, cancelled);
        }
        const [registered, cancelled] = await Promise.all([
            this.searchDataset(SLUG_VAT_REGISTERED, "ico", ico, VAT_DEDUPE_KEYS),
            this.searchDataset(SLUG_VAT_CANCELLED, "ico", ico, VAT_DEDUPE_KEYS),
        ]);
        const vatIds = [...new Set([...registered.data, ...cancelled.data].map((row) => normalizeIcDph(text(row, "ic_dph"))).filter((value) => value !== null))];
        if (vatIds.length === 0)
            throw new FsSourceError("FS_SCHEMA", "FS deleted VAT list cannot be validated from this IČO response.");
        const deleted = mergeAggregatedPages(SLUG_VAT_DELETED, await Promise.all(vatIds.map((value) => this.searchDataset(SLUG_VAT_DELETED, "ic_dph", value, VAT_DEDUPE_KEYS))), VAT_DEDUPE_KEYS);
        return buildVatResult(registered, deleted, cancelled);
    }
    async checkTaxDebtor(input) {
        if (input.ico !== undefined && !normalizeIco(input.ico))
            throw new FsSourceError("FS_INPUT", "IČO must contain exactly eight ASCII digits.");
        const name = input.name?.trim();
        if (!name)
            throw new FsSourceError("FS_INPUT", "A subject name is required for ds_dsdd.");
        const page = await this.searchDataset(SLUG_TAX_DEBTORS, "nazov_subjektu", name, ["ico", "nazov_subjektu", "adresa"]);
        return { isDebtor: page.data.length > 0, matchCount: page.data.length, records: page.data.map(normalizeDebtorRecord), validity: page.validity, note: page.data.length ? undefined : "V overenom zozname sa nenašiel záznam." };
    }
    async getVatBankAccounts(input) { return this.lookupIcDph(input.icDph, SLUG_VAT_IBAN, ["ic_dph", "cislo_uctu"]); }
    async getVatTaxAdminAccount(input) { return this.lookupIcDph(input.icDph, SLUG_VAT_TAX_ADMIN_ACCOUNT, ["ic_dph", "cislo_uctu"]); }
    async getTaxReliabilityIndex(input) { return this.lookupIco(input.ico, SLUG_TAX_RELIABILITY_INDEX, ["ico"]); }
    async getCorporateIncomeTax(input) { return this.lookupIco(input.ico, SLUG_CORPORATE_INCOME_TAX, ["ico", "rok"]); }
    async getIncomeTaxRegistration(input) { return this.lookupIco(input.ico, SLUG_INCOME_TAX_REGISTRATION, ["ico"]); }
    async lookupIcDph(value, slug, keys) {
        const icDph = normalizeIcDph(value);
        if (!icDph)
            throw new FsSourceError("FS_INPUT", "IČ DPH must be SK followed by ten ASCII digits.");
        return this.lookup(slug, "ic_dph", icDph, keys);
    }
    async lookupIco(value, slug, keys) {
        const ico = normalizeIco(value);
        if (!ico)
            throw new FsSourceError("FS_INPUT", "IČO must contain exactly eight ASCII digits.");
        return this.lookup(slug, "ico", ico, keys);
    }
    async lookup(slug, column, search, keys) {
        const result = await this.searchDataset(slug, column, search, keys);
        return { slug, matchCount: result.data.length, records: result.data, validity: result.validity, note: result.data.length ? undefined : "V overenom zozname sa nenašiel záznam." };
    }
    async searchDataset(slug, column, search, keys = ["id"]) {
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
        const unique = dedupe(rows.slice(0, MAX_ROWS), keys);
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
            return { slug: candidate.slug.trim(), ...(candidate.name !== undefined ? { name: candidate.name } : {}), ...(columns !== undefined ? { columns } : {}) };
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
                    const headers = { Accept: "application/json", "User-Agent": "fs-opendata-mcp/0.2.0" };
                    if (this.apiKey)
                        headers.key = this.apiKey;
                    const response = await fetch(url, { method: "GET", headers, signal: controller.signal, redirect: "manual" });
                    if (response.status >= 300 && response.status < 400)
                        throw new FsSourceError("FS_REDIRECT", "FS source redirects are not accepted.");
                    const exactSearchMissCandidate = response.status === 404 && allowExactSearchMiss && params?.get("page") === "1" && /^\/data\/(?:ds_dphs|ds_dphv|ds_dphz|ds_dsdd|ds_dph_oud|ds_dph_iban|ds_dpho|ds_dppos|ds_dsrdp|ds_iz_ran)\/search$/.test(path);
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
