import zlib from "node:zlib";
import { KAPITOLA_CODES, KAPITOLA_GROUPS, } from "./types.js";
export const DEFAULT_OV_BASE_URL = "https://obchodnyvestnik.justice.gov.sk";
const SEARCH_PATH = "/ObchodnyVestnik/Formular/FormulareVyhladavanie.aspx";
const DETAIL_PATH = "/ObchodnyVestnik/Formular/FormularDetail.aspx";
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const MAX_PDF_BYTES = 512 * 1024;
export const MAX_NOTICE_TEXT_BYTES = 128 * 1024;
export const MAX_TEXT_FIELD_BYTES = 8 * 1024;
export const MAX_PAGES = 20;
export const MAX_ROWS = 2_000;
export const UPSTREAM_CONCURRENCY = 4;
export class OvSourceError extends Error {
    code;
    transient;
    constructor(code, message, transient = false) {
        super(message);
        this.code = code;
        this.transient = transient;
        this.name = "OvSourceError";
    }
}
const FIELD_PREFIX = "ctl00$ctl00$CphMain$CphMain$";
class FixedUpstreamSemaphore {
    maximum;
    active = 0;
    waiters = [];
    constructor(maximum) {
        this.maximum = maximum;
    }
    async withPermit(signal, operation) {
        await this.acquire(signal);
        try {
            return await operation();
        }
        finally {
            this.release();
        }
    }
    async acquire(signal) {
        if (signal.aborted)
            throw new DOMException("Aborted", "AbortError");
        if (this.active < this.maximum) {
            this.active += 1;
            return;
        }
        await new Promise((resolve, reject) => {
            const waiter = {
                signal,
                resolve: () => {
                    signal.removeEventListener("abort", waiter.abort);
                    this.active += 1;
                    resolve();
                },
                reject,
                abort: () => {
                    const index = this.waiters.indexOf(waiter);
                    if (index >= 0)
                        this.waiters.splice(index, 1);
                    reject(new DOMException("Aborted", "AbortError"));
                },
            };
            signal.addEventListener("abort", waiter.abort, { once: true });
            this.waiters.push(waiter);
        });
    }
    release() {
        this.active -= 1;
        while (this.waiters.length > 0) {
            const waiter = this.waiters.shift();
            if (waiter.signal.aborted)
                continue;
            waiter.resolve();
            return;
        }
    }
}
export function createUpstreamSemaphore(maximum = UPSTREAM_CONCURRENCY) {
    if (!Number.isSafeInteger(maximum) || maximum < 1)
        throw new OvSourceError("OV_INPUT", "OV upstream concurrency is invalid.");
    return new FixedUpstreamSemaphore(maximum);
}
const PROCESS_UPSTREAM_SEMAPHORE = createUpstreamSemaphore();
/** Read the value="..." of a hidden input with the given id/name from HTML. */
function readHidden(html, name) {
    // Match <input ... name="name" ... value="..." ...> regardless of attribute order.
    const tagRe = new RegExp(`<input[^>]*(?:name|id)=["']${escapeRegExp(name)}["'][^>]*>`, "i");
    const tag = tagRe.exec(html)?.[0];
    if (!tag)
        return "";
    const valRe = /value=["']([\s\S]*?)["']/i;
    const m = valRe.exec(tag);
    return m ? decodeHtmlEntities(m[1]) : "";
}
/**
 * Harvest the ASP.NET WebForms hidden tokens required to POST the search form.
 * Pure: operates on an HTML string. Throws if __VIEWSTATE is absent.
 */
export function parseViewStateTokens(html) {
    const vs = readHidden(html, "__VIEWSTATE");
    const eventValidation = readHidden(html, "__EVENTVALIDATION");
    if (!vs || !eventValidation)
        throw new OvSourceError("OV_SCHEMA", "OV WebForms __VIEWSTATE/__EVENTVALIDATION state is incomplete.");
    return {
        __VIEWSTATE: vs,
        __VIEWSTATEGENERATOR: readHidden(html, "__VIEWSTATEGENERATOR"),
        __EVENTVALIDATION: eventValidation,
    };
}
/**
 * Parse the GridView (id ...gvVyhladavanieOV) result HTML into structured rows.
 * Pure: operates on an HTML string. Columns: row#, Kapitola, Subjekt, Číslo OV,
 * Značka/kód, Dátum zverejnenia, Detail link → FormularDetail.aspx?IdFormular=N.
 */
export function parseSearchRows(html) {
    const table = extractGridViewTable(html);
    if (!table)
        return [];
    const rows = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(table)) !== null) {
        const rowHtml = rowMatch[1];
        // Skip header rows (no <td>, only <th>).
        if (!/<td/i.test(rowHtml))
            continue;
        const cells = [];
        const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
            cells.push(cellMatch[1]);
        }
        if (cells.length === 0)
            continue;
        const detailUrl = extractDetailUrl(rowHtml);
        const idFormular = detailUrl ? extractIdFormular(detailUrl) : 0;
        // Skip pager / non-data rows that carry no detail link.
        if (!idFormular)
            continue;
        const text = cells.map(stripTags);
        rows.push({
            idx: parseInt(text[0], 10) || rows.length + 1,
            kapitola: text[1] ?? "",
            subjekt: text[2] ?? "",
            cisloOV: text[3] ?? "",
            znacka: text[4] ?? "",
            datumZverejnenia: text[5] ?? "",
            idFormular,
            detailUrl,
        });
    }
    return rows;
}
/** Isolate the GridView table HTML so unrelated <tr> rows are not parsed. */
function extractGridViewTable(html) {
    const idx = html.search(/<table[^>]*id=["'][^"']*gvVyhladavanieOV[^"']*["']/i);
    if (idx < 0) {
        // Fall back to whole document if the table id is not present (tests may pass a fragment).
        return /<tr[\s\S]*?<\/tr>/i.test(html) ? html : null;
    }
    const rest = html.slice(idx);
    const end = rest.search(/<\/table>/i);
    return end < 0 ? rest : rest.slice(0, end + "</table>".length);
}
const DETAIL_DIR = "/ObchodnyVestnik/Formular/";
function extractDetailUrl(rowHtml) {
    const m = /href=["']([^"']*FormularDetail\.aspx\?IdFormular=\d+)["']/i.exec(rowHtml);
    if (!m)
        return "";
    const url = decodeHtmlEntities(m[1]);
    if (url.startsWith("http") || url.startsWith(DETAIL_DIR))
        return url;
    // Relative or root-relative href → normalise to the canonical detail path.
    const id = extractIdFormular(url);
    return `${DETAIL_DIR}FormularDetail.aspx?IdFormular=${id}`;
}
function extractIdFormular(url) {
    const m = /IdFormular=(\d+)/i.exec(url);
    return m ? parseInt(m[1], 10) : 0;
}
/**
 * Extract structured fields from the plain text of a notice-detail PDF.
 * Pure: operates on already-extracted text. Recognises the shared OV
 * labeled-field layout (Názov, Sídlo, IČO, form code, header band, footer).
 */
export function parseNoticeText(text, idFormular, sourceUrl) {
    const clean = capUtf8(decodeHtmlEntities(text).replace(/\r\n/g, "\n"), MAX_NOTICE_TEXT_BYTES);
    const polia = {};
    const labelValue = (label) => {
        // "Label: value" or "Label value" on the same line.
        const re = new RegExp(`${escapeRegExp(label)}\\s*:?\\s*([^\\n]+)`, "i");
        const m = re.exec(clean);
        return m ? capUtf8(m[1].trim(), MAX_TEXT_FIELD_BYTES) : undefined;
    };
    // Header band: "Obchodný vestník {cislo}/{rocnik}"
    const cisloOV = /Obchodný vestník\s+(\d+\s*\/\s*\d{4})/i.exec(clean)?.[1]?.replace(/\s+/g, "");
    const denVydania = /Deň vydania:?\s*(\d{2}\.\d{2}\.\d{4})/i.exec(clean)?.[1];
    // Form code: a capitalised letter + digits token, e.g. Š004044, R019413, K012345.
    // Avoid \b around non-ASCII letters; require a non-letter/leading boundary instead.
    const kodFormulara = /(?:^|[^A-Za-zÀ-ž])([A-ZÀ-Ž][0-9]{4,7})(?![0-9])/m.exec(clean)?.[1];
    const nazov = labelValue("Názov") ?? labelValue("Obchodné meno") ?? labelValue("Úpadca");
    const sidlo = labelValue("Sídlo") ?? labelValue("Bydlisko");
    const ico = /IČO\s*:?\s*(\d{6,8})/i.exec(clean)?.[1];
    const pravnaForma = labelValue("Právna forma");
    // Common insolvency / auction fields — best-effort.
    for (const label of [
        "Súd",
        "Spisová značka",
        "Správca",
        "Predmet",
        "Najnižšie podanie",
        "Termín",
        "Lehota",
        "Za rok",
    ]) {
        const v = labelValue(label);
        if (v)
            polia[capUtf8(label, MAX_TEXT_FIELD_BYTES)] = v;
    }
    const vydava = /Vydáva\s+Ministerstvo[^\n]*/i.exec(clean)?.[0]?.trim();
    const nazovFormulara = /Obchodný vestník\s+\d+\s*\/\s*\d{4}\s*\n+\s*([^\n]+)/i
        .exec(clean)?.[1]
        ?.trim();
    return {
        idFormular,
        kodFormulara: capOptional(kodFormulara),
        nazovFormulara: capOptional(nazovFormulara),
        cisloOV: capOptional(cisloOV),
        denVydania: capOptional(denVydania),
        subjekt: { pravnaForma, nazov, sidlo, ico },
        polia,
        text: clean.trim(),
        vydava: capOptional(vydava),
        sourceUrl,
        sourceFormat: "application/pdf",
    };
}
// ===========================================================================
// Client
// ===========================================================================
export class OvClient {
    base;
    fetchImpl;
    timeoutMs;
    retries;
    retryDelayMs;
    upstreamSemaphore;
    constructor(opts = {}) {
        this.base =
            // `??` prepadne len na null/undefined. Keby compose poslal premennú
            // NASTAVENÚ, ALE PRÁZDNU (tvar "${OV_BASE_URL:-}"), base by bola "" a každé
            // volanie by skončilo na fetch("/...") s hláškou "Failed to parse URL".
            // Presne tak dnes vypadol Register úpadcov (RU-MCP#8).
            normalizeBaseUrl(opts.baseUrl?.trim() || process.env.OV_BASE_URL?.trim() || DEFAULT_OV_BASE_URL);
        this.fetchImpl = opts.fetchImpl ?? fetch;
        this.timeoutMs = opts.timeoutMs ?? 30000;
        this.retries = opts.retries ?? 2;
        this.retryDelayMs = opts.retryDelayMs ?? 300;
        this.upstreamSemaphore = opts.upstreamSemaphore ?? PROCESS_UPSTREAM_SEMAPHORE;
    }
    async withTimeout(fn) {
        const ctrl = new AbortController();
        let timer;
        const timeout = new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
                ctrl.abort();
                reject(new OvSourceError("OV_TIMEOUT", "OV public source request timed out.", true));
            }, this.timeoutMs);
        });
        try {
            return await Promise.race([fn(ctrl.signal), timeout]);
        }
        catch (error) {
            if (error instanceof OvSourceError)
                throw error;
            if (isAbortError(error))
                throw new OvSourceError("OV_TIMEOUT", "OV public source request timed out.", true);
            throw new OvSourceError("OV_HTTP", "OV public source request failed.", true);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    async request(initialUrl, init, expectedType, maximumBytes) {
        return this.withTimeout(async (signal) => {
            let currentUrl = new URL(initialUrl);
            let currentInit = { ...init, signal, redirect: "manual" };
            const initialOrigin = currentUrl.origin;
            for (let hop = 0; hop <= 1; hop += 1) {
                const outcome = await this.upstreamSemaphore.withPermit(signal, async () => {
                    const response = await this.fetchImpl(currentUrl, currentInit);
                    if (isRedirectStatus(response.status)) {
                        const location = response.headers.get("location");
                        if (!location || hop === 1) {
                            await cancelResponseBody(response);
                            throw new OvSourceError("OV_HTTP", "OV public source redirect was rejected.");
                        }
                        await cancelResponseBody(response);
                        return { kind: "redirect", location, status: response.status };
                    }
                    if (response.status !== 200) {
                        await cancelResponseBody(response);
                        throw new OvSourceError("OV_HTTP", "OV public source returned a non-success status.", response.status >= 500);
                    }
                    const contentType = response.headers.get("content-type") ?? "";
                    const accepted = expectedType === "html"
                        ? /^text\/html(?:\s*;|$)/i.test(contentType)
                        : /^application\/pdf(?:\s*;|$)/i.test(contentType);
                    if (!accepted) {
                        await cancelResponseBody(response);
                        throw new OvSourceError("OV_CONTENT_TYPE", "OV public source returned an unsupported content type.");
                    }
                    const buffer = await readBoundedResponse(response, maximumBytes);
                    return { kind: "result", buffer, response, finalUrl: currentUrl.href };
                });
                if (outcome.kind === "result")
                    return outcome;
                let next;
                try {
                    next = new URL(outcome.location, currentUrl);
                }
                catch {
                    throw new OvSourceError("OV_HTTP", "OV public source redirect was rejected.");
                }
                if (next.origin !== initialOrigin || next.username || next.password)
                    throw new OvSourceError("OV_HTTP", "OV public source redirect was rejected.");
                currentUrl = next;
                if (outcome.status === 303 || ((outcome.status === 301 || outcome.status === 302) && currentInit.method === "POST")) {
                    const { body: _body, ...withoutBody } = currentInit;
                    currentInit = { ...withoutBody, method: "GET", signal, redirect: "manual" };
                }
            }
            throw new OvSourceError("OV_HTTP", "OV public source redirect was rejected.");
        });
    }
    /**
     * ov_search: GET the form to harvest ViewState, then POST filter fields.
     * Maintains the session cookie across the two requests.
     */
    async search(params) {
        validateSearchParams(params);
        const kapitoly = resolveKapitoly(params);
        if (kapitoly.length > 1) {
            const results = [];
            const breakdown = [];
            for (const kapitola of kapitoly) {
                const result = await this.searchSingleWithRetry({
                    ...params,
                    kapitola,
                    kapitolaGroup: undefined,
                });
                results.push(result);
                breakdown.push({
                    kapitola,
                    label: KAPITOLA_CODES[kapitola] ?? kapitola,
                    rowCount: result.rows.length,
                    newest: newestDate(result.rows),
                });
            }
            const rowsById = new Map();
            for (const result of results) {
                for (const row of result.rows) {
                    rowsById.set(row.idFormular, row);
                }
            }
            const rows = [...rowsById.values()].sort(compareSearchRows);
            return {
                query: pruneUndefined({ ...params, kapitoly }),
                page: params.page ?? 1,
                countOnPage: params.countOnPage ?? 10,
                rowCount: rows.length,
                rows,
                sourceTotal: results.every((result) => result.sourceTotal !== null)
                    ? results.reduce((sum, result) => sum + (result.sourceTotal ?? 0), 0)
                    : null,
                truncated: results.some((result) => result.truncated),
                truncationReason: results.some((result) => result.truncated) ? "source_has_more_rows" : null,
                kapitolyDetail: breakdown,
                warnings: buildKapitolaWarnings(breakdown) ?? [],
            };
        }
        return this.searchSingleWithRetry({ ...params, kapitola: kapitoly[0] ?? params.kapitola });
    }
    async searchSingleWithRetry(params) {
        let lastError;
        for (let attempt = 0; attempt <= this.retries; attempt += 1) {
            try {
                return await this.searchSingle(params);
            }
            catch (error) {
                lastError = error;
                if (!isTransientSearchError(error) || attempt === this.retries) {
                    throw error;
                }
                await delay(this.retryDelayMs * 2 ** attempt);
            }
        }
        throw lastError;
    }
    async searchSingle(params) {
        const url = new URL(SEARCH_PATH, this.base).href;
        // 1) GET to harvest tokens + cookies.
        const formResponse = await this.request(url, {
            method: "GET",
            headers: { "User-Agent": "obchodny-vestnik-mcp/0.1", Accept: "text/html" },
        }, "html", MAX_RESPONSE_BYTES);
        const html = formResponse.buffer.toString("utf8");
        const cookie = formResponse.response.headers.get("set-cookie") ?? "";
        const tokens = parseViewStateTokens(html);
        validateSearchForm(html);
        // 2) Build the POST body.
        const page = params.page ?? 1;
        const countOnPage = params.countOnPage ?? 10;
        const kapitola = params.kapitola;
        const body = new URLSearchParams();
        body.set("__EVENTTARGET", "");
        body.set("__EVENTARGUMENT", "");
        body.set("__VIEWSTATE", tokens.__VIEWSTATE);
        body.set("__VIEWSTATEGENERATOR", tokens.__VIEWSTATEGENERATOR);
        body.set("__EVENTVALIDATION", tokens.__EVENTVALIDATION);
        setField(body, "txtKlucoveSlova", params.keywords);
        setField(body, "txtZnackaCisloKod", params.mark);
        setField(body, "txtObchodneMenoMenoPriezvisko", params.name);
        setField(body, "txtIco", params.ico);
        setField(body, "txtSidloBydlisko", params.seat);
        setField(body, "cmbObchodnyVestnikRocnik", params.year ?? "");
        setField(body, "cmbKapitola", kapitola ?? "");
        setField(body, "hfKapitola", kapitola ?? "");
        setField(body, "cmbTypPodania", "");
        if (params.date) {
            setField(body, "DatumZverejnenia", "rbDen");
            setField(body, "txtDatumZverejnenia", params.date);
        }
        setField(body, "btnVyhladat", "Vyhľadať");
        setField(body, "gvVyhladavanieOV$ctl13$ctl00$cmbAGVCountOnPage", String(countOnPage));
        if (page > 1) {
            setField(body, "gvVyhladavanieOV$ctl13$ctl00$cmbAGVPager", String(page));
        }
        // 3) POST.
        const headers = {
            "User-Agent": "obchodny-vestnik-mcp/0.1",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "text/html",
        };
        if (cookie)
            headers.Cookie = cookie.split(";")[0] ?? "";
        const searchResponse = await this.request(url, { method: "POST", headers, body: body.toString() }, "html", MAX_RESPONSE_BYTES);
        const resultHtml = searchResponse.buffer.toString("utf8");
        const rows = parseSearchRows(resultHtml);
        const sourceTotal = validateSearchDocument(resultHtml, rows);
        const truncated = sourceTotal === null
            ? (parseHasNextPage(resultHtml, page) ?? rows.length >= countOnPage)
            : page * countOnPage < sourceTotal;
        return {
            query: pruneUndefined({ ...params, kapitola }),
            page,
            countOnPage,
            rowCount: rows.length,
            rows,
            sourceTotal,
            truncated,
            truncationReason: truncated ? "source_has_more_rows" : null,
            kapitolyDetail: [],
            warnings: sourceTotal === null ? ["source_total_unavailable"] : [],
        };
    }
    /**
     * ov_get_notice: download the detail PDF and extract its text + fields.
     * The detail page returns application/pdf, so we parse the PDF text.
     */
    async getNotice(idFormular) {
        if (!Number.isSafeInteger(idFormular) || idFormular < 1)
            throw new OvSourceError("OV_INPUT", "IdFormular is invalid.");
        const sourceUrl = new URL(`${DETAIL_PATH}?IdFormular=${idFormular}`, this.base).href;
        const { buffer } = await this.request(sourceUrl, {
            method: "GET",
            headers: { "User-Agent": "obchodny-vestnik-mcp/0.1", Accept: "application/pdf" },
        }, "pdf", MAX_PDF_BYTES);
        if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-")
            throw new OvSourceError("OV_SCHEMA", "OV detail PDF signature is invalid.");
        const text = extractPdfText(buffer);
        if (!text.trim())
            throw new OvSourceError("OV_SCHEMA", "OV detail PDF contained no extractable text.");
        return parseNoticeText(text, idFormular, sourceUrl);
    }
}
// ===========================================================================
// Helpers
// ===========================================================================
function resolveKapitoly(params) {
    if (params.kapitola)
        return [params.kapitola];
    if (params.kapitolaGroup)
        return KAPITOLA_GROUPS[params.kapitolaGroup] ?? [];
    return [];
}
/** Newest DD.MM.RRRR in a row set, or null when there is nothing to date. */
export function newestDate(rows) {
    let best = null;
    for (const row of rows) {
        const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(row.datumZverejnenia ?? "").trim());
        if (!m)
            continue;
        const key = Number(`${m[3]}${m[2]}${m[1]}`);
        if (!best || key > best.key)
            best = { key, value: m[0] };
    }
    return best?.value ?? null;
}
/**
 * A chapter that returns nothing while its siblings return rows is the thing a
 * merged result hides best — and for an insolvency check that reads as "no
 * proceedings found" rather than "one chapter answered nothing".
 */
export function buildKapitolaWarnings(breakdown) {
    const empty = breakdown.filter((b) => b.rowCount === 0);
    if (empty.length === 0 || empty.length === breakdown.length)
        return undefined;
    const names = empty.map((b) => `${b.kapitola} (${b.label})`).join(", ");
    return [
        `Kapitoly ${names} nevrátili k tomuto dopytu žiadny záznam, kým ostatné áno. ` +
            "Výsledok preto nemožno čítať ako úplný — over si tieto kapitoly samostatne " +
            "cez ov_search s parametrom kapitola.",
    ];
}
function isTransientSearchError(error) {
    if (error instanceof OvSourceError)
        return error.transient;
    const message = error instanceof Error ? error.message : String(error);
    return /HTTP 5\d\d|fetch failed|aborted|timeout/i.test(message);
}
function delay(ms) {
    if (ms <= 0)
        return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function compareSearchRows(a, b) {
    const dateDiff = parseOvDate(b.datumZverejnenia) - parseOvDate(a.datumZverejnenia);
    if (dateDiff !== 0)
        return dateDiff;
    return a.idFormular - b.idFormular;
}
function parseOvDate(date) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
    if (!m)
        return 0;
    return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}
function setField(body, suffix, value) {
    if (value === undefined)
        return;
    body.set(`${FIELD_PREFIX}${suffix}`, value);
}
function pruneUndefined(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined && v !== "")
            out[k] = v;
    }
    return out;
}
function normalizeBaseUrl(value) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new OvSourceError("OV_INPUT", "OV base URL is invalid.");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new OvSourceError("OV_INPUT", "OV base URL is invalid.");
    }
    return parsed.href.replace(/\/+$/, "");
}
function validateSearchParams(params) {
    const textFields = [params.name, params.keywords, params.mark, params.seat, params.year, params.date];
    if (textFields.some((value) => value !== undefined && (!value.trim() || Buffer.byteLength(value, "utf8") > 256))) {
        throw new OvSourceError("OV_INPUT", "OV search input is invalid.");
    }
    if (params.ico !== undefined && !/^\d{8}$/.test(params.ico))
        throw new OvSourceError("OV_INPUT", "IČO is invalid.");
    if (params.kapitola !== undefined && !Object.hasOwn(KAPITOLA_CODES, params.kapitola))
        throw new OvSourceError("OV_INPUT", "OV chapter is invalid.");
    if (params.kapitola && params.kapitolaGroup)
        throw new OvSourceError("OV_INPUT", "OV chapter input is ambiguous.");
    if (params.page !== undefined && (!Number.isSafeInteger(params.page) || params.page < 1 || params.page > MAX_PAGES))
        throw new OvSourceError("OV_INPUT", "OV page is invalid.");
    if (!params.name && !params.ico && !params.keywords && !params.mark && !params.seat && !params.kapitola && !params.kapitolaGroup)
        throw new OvSourceError("OV_INPUT", "OV search criterion is required.");
}
function parseSourceTotal(html) {
    const candidates = [
        /(?:Celkový\s+počet\s+záznamov|Počet\s+záznamov|Počet\s+výsledkov)\s*:?\s*<[^>]*>?\s*([0-9][0-9\s]*)/i,
        /(?:Celkový\s+počet\s+záznamov|Počet\s+záznamov|Počet\s+výsledkov)\s*:?\s*([0-9][0-9\s]*)/i,
        /id=["'][^"']*(?:lblPocetZaznamov|lblCount|TotalCount)[^"']*["'][^>]*>\s*([^<]+)/i,
    ];
    for (const candidate of candidates) {
        const match = candidate.exec(html)?.[1];
        const digits = match?.replace(/\s+/g, "");
        if (digits && /^\d+$/.test(digits)) {
            const total = Number(digits);
            if (Number.isSafeInteger(total) && total >= 0 && total <= Number.MAX_SAFE_INTEGER)
                return total;
        }
    }
    return undefined;
}
function validateSearchForm(html) {
    parseViewStateTokens(html);
    if (!/<table[^>]*id=["'][^"']*gvVyhladavanieOV[^"']*["']/i.test(html))
        throw new OvSourceError("OV_SCHEMA", "OV result table marker is missing.");
}
function parseHasNextPage(html, page) {
    const pager = /<select[^>]*(?:name|id)=["'][^"']*cmbAGVPager[^"']*["'][^>]*>([\s\S]*?)<\/select>/i.exec(html)?.[1];
    if (!pager)
        return null;
    return Array.from(pager.matchAll(/<option[^>]*value=["'](\d+)["']/gi))
        .some((match) => Number(match[1]) > page);
}
function validateSearchDocument(html, rows = []) {
    validateSearchForm(html);
    const total = parseSourceTotal(html);
    if (total === undefined && rows.length === 0)
        throw new OvSourceError("OV_SCHEMA", "OV explicit result total is missing.");
    if ((total !== undefined && rows.length > total) || rows.length > MAX_ROWS)
        throw new OvSourceError("OV_SCHEMA", "OV result count contradicts the source total.");
    const seen = new Set();
    for (const row of rows) {
        if (!Number.isSafeInteger(row.idFormular) || row.idFormular < 1 || seen.has(row.idFormular))
            throw new OvSourceError("OV_SCHEMA", "OV result row identifier is invalid.");
        seen.add(row.idFormular);
        if (row.detailUrl !== `${DETAIL_PATH}?IdFormular=${row.idFormular}`)
            throw new OvSourceError("OV_SCHEMA", "OV result detail URL is invalid.");
        for (const value of [row.kapitola, row.subjekt, row.cisloOV, row.znacka, row.datumZverejnenia, row.detailUrl]) {
            if (Buffer.byteLength(value, "utf8") > MAX_TEXT_FIELD_BYTES)
                throw new OvSourceError("OV_SCHEMA", "OV result field exceeds its bound.");
        }
    }
    return total ?? null;
}
function isRedirectStatus(status) {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
function isAbortError(error) {
    return error instanceof DOMException && error.name === "AbortError"
        || Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}
async function readBoundedResponse(response, maximumBytes) {
    const declared = response.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
        await cancelResponseBody(response);
        throw new OvSourceError("OV_SCHEMA", "OV public source response exceeded its size bound.");
    }
    if (!response.body)
        return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done)
                break;
            const chunk = Buffer.from(next.value);
            total += chunk.length;
            if (total > maximumBytes)
                throw new OvSourceError("OV_SCHEMA", "OV public source response exceeded its size bound.");
            chunks.push(chunk);
        }
        return Buffer.concat(chunks, total);
    }
    catch (error) {
        try {
            await reader.cancel();
        }
        catch { /* The stream is already closed or errored. */ }
        throw error;
    }
    finally {
        reader.releaseLock();
    }
}
async function cancelResponseBody(response) {
    try {
        await response.body?.cancel();
    }
    catch { /* The stream is already closed or errored. */ }
}
function capUtf8(value, maximumBytes) {
    if (Buffer.byteLength(value, "utf8") <= maximumBytes)
        return value;
    let output = value;
    while (Buffer.byteLength(output, "utf8") > maximumBytes)
        output = output.slice(0, Math.max(0, output.length - 1));
    return output;
}
function capOptional(value) {
    return value === undefined ? undefined : capUtf8(value, MAX_TEXT_FIELD_BYTES);
}
function stripTags(html) {
    return decodeHtmlEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
export function decodeHtmlEntities(s) {
    return s
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, " ");
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * Minimal PDF text extractor: pulls text from content streams using the
 * Tj / TJ show-text operators. No external dependency. Handles uncompressed
 * (and FlateDecode via zlib) content streams. Best-effort — sufficient for the
 * labeled-field layout of OV notice PDFs.
 */
export function extractPdfText(pdf) {
    const chunks = [];
    // Find stream...endstream blocks.
    const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let m;
    let any = false;
    while ((m = streamRe.exec(pdf.toString("latin1"))) !== null) {
        any = true;
        const raw = Buffer.from(m[1], "latin1");
        // Try zlib inflate (FlateDecode); fall back to raw bytes.
        let content = "";
        try {
            content = zlib.inflateSync(raw, { maxOutputLength: MAX_NOTICE_TEXT_BYTES }).toString("latin1");
        }
        catch {
            content = raw.toString("latin1");
        }
        chunks.push(extractTextOperators(content));
    }
    const joined = chunks.join("\n");
    if (joined.trim().length > 0)
        return recoverUtf8(joined);
    // Last resort: scan parenthesised strings across the whole file.
    return any ? joined : recoverUtf8(extractTextOperators(pdf.toString("latin1")));
}
/**
 * PDF literal strings are read as latin1 bytes. When the producer emitted UTF-8
 * bytes (common for Slovak diacritics), re-decode the latin1 string through
 * UTF-8 to recover characters like č, š, ž, á. If the bytes are not valid UTF-8
 * the original string is returned unchanged.
 */
function recoverUtf8(s) {
    if (!/[-ÿ]/.test(s))
        return s; // pure ASCII — nothing to recover
    try {
        const bytes = Buffer.from(s, "latin1");
        const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        // Heuristic: prefer the decode that yields fewer replacement chars.
        const badIn = (s.match(/�/g) ?? []).length;
        const badOut = (decoded.match(/�/g) ?? []).length;
        return badOut <= badIn ? decoded : s;
    }
    catch {
        return s;
    }
}
/** Pull text out of PDF show-text operators: (str)Tj and [(a)(b)]TJ. */
function extractTextOperators(content) {
    const out = [];
    // (string) Tj
    const tjRe = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
    let m;
    while ((m = tjRe.exec(content)) !== null)
        out.push(unescapePdfString(m[1]));
    // [ (a) (b) ... ] TJ
    const tjArrRe = /\[((?:[^\]\\]|\\.)*)\]\s*TJ/g;
    while ((m = tjArrRe.exec(content)) !== null) {
        const inner = m[1];
        const strRe = /\(((?:\\.|[^\\)])*)\)/g;
        let s;
        const parts = [];
        while ((s = strRe.exec(inner)) !== null)
            parts.push(unescapePdfString(s[1]));
        out.push(parts.join(""));
    }
    return out.join("\n");
}
function unescapePdfString(s) {
    return s
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\")
        .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}
