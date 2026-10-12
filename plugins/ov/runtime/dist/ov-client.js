import { KAPITOLA_CODES, KAPITOLA_GROUPS, OV_FACTS_VERIFIED_ON, OV_KAR_LAST_NOTICE, } from "./types.js";
import { extractPdfText } from "./pdf-text.js";
export { extractPdfText, parseToUnicode } from "./pdf-text.js";
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
/** The cell the source renders when a query matched nothing. */
const EMPTY_RESULT_MARKER = /Vyhľadávacím kritériám nevyhovujú žiadne údaje/i;
/**
 * Read a search response. Zero rows count as "nothing found" only when the
 * source says so in the grid; a page without the grid (error page, changed
 * layout) or an empty grid without that sentence is an error, never a clean
 * zero.
 */
export function readSearchPage(html) {
    if (!/<table[^>]*id=["'][^"']*gvVyhladavanieOV[^"']*["']/i.test(html)) {
        throw new OvSourceError("OV_SCHEMA", "OV result table marker is missing.");
    }
    const rows = parseSearchRows(html);
    const pager = readSelect(html, "cmbAGVPager");
    const size = readSelect(html, "cmbAGVCountOnPage");
    if (rows.length === 0) {
        if (!EMPTY_RESULT_MARKER.test(extractGridViewTable(html) ?? "")) {
            throw new OvSourceError("OV_SCHEMA", "OV empty result lacks the source's no-data sentence.");
        }
        return { rows, pageCount: 0, currentPage: 1, countOnPage: null, pagerName: null, countOnPageName: null };
    }
    const pageNumbers = pager?.values.map(Number).filter(Number.isFinite) ?? [];
    return {
        rows,
        pageCount: pageNumbers.length > 0 ? Math.max(...pageNumbers) : 1,
        currentPage: pager?.selected ? Number(pager.selected) : 1,
        countOnPage: size?.selected ? Number(size.selected) : null,
        pagerName: pager?.name ?? null,
        countOnPageName: size?.name ?? null,
    };
}
function readSelect(html, suffix) {
    const m = new RegExp(`<select[^>]*name=["']([^"']*${suffix})["'][^>]*>([\\s\\S]*?)<\\/select>`, "i").exec(html);
    if (!m)
        return null;
    const values = [];
    let selected = null;
    for (const o of m[2].matchAll(/<option([^>]*)>/gi)) {
        const value = /value=["']([^"']*)["']/i.exec(o[1])?.[1];
        if (value === undefined)
            continue;
        values.push(value);
        if (/selected/i.test(o[1]))
            selected = value;
    }
    return { name: decodeHtmlEntities(m[1]), values, selected };
}
/** The requested page is beyond the last page the source offers. */
export class OvPageOutOfRangeError extends OvSourceError {
    page;
    pageCount;
    constructor(page, pageCount) {
        super("OV_INPUT", "OV page is beyond the last result page.");
        this.page = page;
        this.pageCount = pageCount;
        this.name = "OvPageOutOfRangeError";
    }
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
 * Pure: operates on already-extracted text.
 *
 * Only labeled header lines count ("Label: value" at the start of a line).
 * A label found anywhere in the running text picked up other people's data —
 * the attorney's address as the subject's seat, part of "Názov ulice…" as the
 * name — so a field the header does not carry stays empty instead.
 */
export function parseNoticeText(text, idFormular, sourceUrl) {
    const clean = capUtf8(decodeHtmlEntities(text).replace(/\r\n?/g, "\n"), MAX_NOTICE_TEXT_BYTES);
    const lines = clean.split("\n").map((l) => l.replace(/\s+/g, " ").trim());
    // Value of the first line starting with one of the labels; lower-case
    // continuation lines (a wrapped address) are appended.
    const labeled = (labels) => {
        const re = new RegExp(`^(?:${labels.map(escapeRegExp).join("|")})\\s*:\\s*(.*)$`);
        for (let i = 0; i < lines.length; i += 1) {
            const m = re.exec(lines[i]);
            if (!m)
                continue;
            let value = m[1];
            while (i + 1 < lines.length && /^\p{Ll}/u.test(lines[i + 1]))
                value += ` ${lines[++i]}`;
            value = capUtf8(value.trim(), MAX_TEXT_FIELD_BYTES);
            if (value)
                return value;
        }
        return undefined;
    };
    // Header band: "Obchodný vestník {cislo}/{rocnik} [section] Deň vydania: dd.mm.yyyy",
    // on one line or spread over several.
    const header = /Obchodný vestník\s+(\d+\s*\/\s*\d{4})([\s\S]{0,200}?)Deň vydania:?\s*(\d{2}\.\d{2}\.\d{4})/i.exec(clean);
    const cisloOV = header?.[1].replace(/\s+/g, "");
    const denVydania = header?.[3];
    const nazovFormulara = header?.[2].replace(/\s+/g, " ").trim() || undefined;
    // Form code: a line holding only a letter + digits token, e.g. Š004044, K041801, R114765.
    const kodFormulara = lines.find((l) => /^\p{Lu}\d{4,7}$/u.test(l));
    const nazov = labeled([
        "Obchodné meno/Názov/Meno a priezvisko dlžníka/úpadcu",
        "OBCHODNÉ MENO",
        "Obchodné meno",
        "Názov",
    ]);
    const sidlo = labeled([
        "Sídlo/Miesto podnikania/Bydlisko dlžníka/úpadcu",
        "Sídlo/Bydlisko dlžníka/úpadcu",
        "SÍDLO",
        "Sídlo",
        "Bydlisko",
    ])
        // Commercial-register notices spell the address out field by field.
        ?.replace(/Názov ulice\/verejného priestranstva a orientačné číslo \(príp\. súpisné číslo\):\s*/g, "")
        .replace(/Názov obce:\s*/g, "")
        .replace(/PSČ:\s*/g, "")
        .trim();
    // IČO is printed with spaces ("31 562 167"); a date of birth in the same
    // field is not an IČO.
    const icoRaw = labeled(["IČO/Dátum narodenia dlžníka/úpadcu", "IČO"]);
    const icoDigits = icoRaw?.replace(/\s+/g, "");
    const ico = icoDigits && /^\d{6,8}$/.test(icoDigits) ? icoDigits.padStart(8, "0") : undefined;
    const pravnaForma = labeled(["PRÁVNA FORMA", "Právna forma"]);
    const polia = {};
    const set = (key, value) => {
        if (value)
            polia[key] = capUtf8(value, MAX_TEXT_FIELD_BYTES);
    };
    set("Spisová značka", labeled(["Spisová značka súdneho spisu", "Spisová značka", "Sp. zn."]));
    set("Spisová značka správcu", labeled(["Spisová značka správcovského spisu"]));
    // A court from its header label, or a line that is nothing but a court name
    // ("Krajský súd v Banskej Bystrici", "Okresný súd Žilina - Zmena zápisov");
    // never from a sentence or a signature line ("… dňa 20.8.2025").
    set("Súd", labeled(["Príslušný konkurzný súd"]) ??
        lines
            .find((l) => /^(?:Najvyšší|Krajský|Okresný|Mestský) súd\b[^:,]{0,60}$/u.test(l) && !/\bdňa\b/u.test(l))
            ?.replace(/\s+-\s+.*$/, ""));
    set("Správca", labeled(["Titul, meno a priezvisko správcu", "Správca"]));
    set("Sídlo správcu", labeled(["Sídlo správcu"]));
    set("Druh podania", labeled(["Druh podania"]));
    for (const label of ["Predmet", "Najnižšie podanie", "Termín", "Lehota", "Za rok"]) {
        set(label, labeled([label]));
    }
    const vydava = /Vydáva\s+Ministerstvo[^\n]*/i.exec(clean)?.[0]?.trim();
    return {
        idFormular,
        kodFormulara: capOptional(kodFormulara),
        nazovFormulara: capOptional(nazovFormulara),
        cisloOV: capOptional(cisloOV),
        denVydania: capOptional(denVydania),
        subjekt: pruneUndefined({ pravnaForma, nazov, sidlo, ico }),
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
                        : /^application\/(?:pdf|octet-stream)(?:\s*;|$)/i.test(contentType);
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
            const outOfRange = [];
            for (const kapitola of kapitoly) {
                let result;
                try {
                    result = await this.searchSingleWithRetry({
                        ...params,
                        kapitola,
                        kapitolaGroup: undefined,
                    });
                }
                catch (error) {
                    // A chapter with fewer pages than requested has nothing on this
                    // page; that is not a failure of the whole group.
                    if (!(error instanceof OvPageOutOfRangeError))
                        throw error;
                    outOfRange.push(`${kapitola} (${error.pageCount})`);
                    result = emptyResult(params, kapitola, error.pageCount);
                }
                results.push(result);
                breakdown.push({
                    kapitola,
                    label: KAPITOLA_CODES[kapitola] ?? kapitola,
                    rowCount: result.rows.length,
                    newest: newestDate(result.rows),
                    pageCount: result.pageCount,
                    truncated: result.truncated,
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
                pageCount: Math.max(0, ...results.map((result) => result.pageCount)),
                sourceTotal: results.every((result) => result.sourceTotal !== null)
                    ? results.reduce((sum, result) => sum + (result.sourceTotal ?? 0), 0)
                    : null,
                truncated: results.some((result) => result.truncated),
                truncationReason: results.some((result) => result.truncated) ? "source_has_more_rows" : null,
                kapitolyDetail: breakdown,
                warnings: [
                    ...(buildKapitolaWarnings(breakdown) ?? []),
                    ...(outOfRange.length > 0
                        ? [`Kapitoly ${outOfRange.join(", ")} nemajú stranu ${params.page ?? 1}; ich záznamy sú na nižších stranách.`]
                        : []),
                    ...coverageWarnings(kapitoly, params),
                ],
            };
        }
        const kapitola = kapitoly[0] ?? params.kapitola;
        const result = await this.searchSingleWithRetry({ ...params, kapitola });
        return { ...result, warnings: [...result.warnings, ...coverageWarnings(kapitola ? [kapitola] : [], params)] };
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
        // 2) POST the search. The source always answers a new search with page 1.
        const requestedPage = params.page ?? 1;
        const countOnPage = params.countOnPage ?? 10;
        const kapitola = params.kapitola;
        const body = searchFormBody(tokens, params);
        setField(body, "btnVyhladat", "Vyhľadať");
        setField(body, "gvVyhladavanieOV$ctl13$ctl00$cmbAGVCountOnPage", String(countOnPage));
        const headers = {
            "User-Agent": "obchodny-vestnik-mcp/0.1",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "text/html",
        };
        if (cookie)
            headers.Cookie = cookie.split(";")[0] ?? "";
        const post = async (form) => (await this.request(url, { method: "POST", headers, body: form.toString() }, "html", MAX_RESPONSE_BYTES))
            .buffer.toString("utf8");
        let resultHtml = await post(body);
        let page = readSearchPage(resultHtml);
        // 3) Further pages are a postback of the pager on the result page, with
        // that page's ViewState. Setting the pager next to the search button
        // started a new search and silently returned page 1 again.
        if (requestedPage > 1) {
            if (requestedPage > page.pageCount || !page.pagerName) {
                throw new OvPageOutOfRangeError(requestedPage, page.pageCount);
            }
            const pagerBody = searchFormBody(parseViewStateTokens(resultHtml), params);
            pagerBody.set("__EVENTTARGET", page.pagerName);
            pagerBody.set(page.pagerName, String(requestedPage));
            if (page.countOnPageName)
                pagerBody.set(page.countOnPageName, String(page.countOnPage ?? countOnPage));
            resultHtml = await post(pagerBody);
            page = readSearchPage(resultHtml);
            if (page.currentPage !== requestedPage)
                throw new OvSourceError("OV_SCHEMA", "OV returned a different result page.");
        }
        validateSearchRows(page.rows);
        const size = page.countOnPage ?? countOnPage;
        // A full page without a pager is not proof of completeness: stay
        // conservative rather than call it the whole result.
        const unknownMore = !page.pagerName && page.rows.length >= size;
        const truncated = page.currentPage < page.pageCount || unknownMore;
        // The source prints no total, only a pager: the total is exact on the last page.
        const sourceTotal = truncated ? null : Math.max(0, page.pageCount - 1) * size + page.rows.length;
        return {
            query: pruneUndefined({ ...params, kapitola }),
            page: requestedPage,
            countOnPage: size,
            rowCount: page.rows.length,
            rows: page.rows,
            pageCount: page.pageCount,
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
/** Pointer used wherever OV_KaR can be part of the answer. */
export const KAR_COVERAGE_WARNING = `Kapitola OV_KaR (Konkurzy a reštrukturalizácie) nemá v Obchodnom vestníku žiadne oznámenie ` +
    `novšie ako ${OV_KAR_LAST_NOTICE} (overené ${OV_FACTS_VERIFIED_ON}). Prázdny alebo starší výsledok ` +
    "preto neznamená, že subjekt nie je v konkurze či reštrukturalizácii — novšie konania over " +
    "v Registri úpadcov (napr. ru_get_by_ico).";
const DOCH_NOTE = "Skupina insolvency nezahŕňa kapitolu OV_DOch (Dočasná ochrana); ak je relevantná, " +
    "hľadaj ju samostatne cez kapitola: \"OV_DOch\".";
/** Notes about what the searched chapters cannot contain, independent of the rows. */
export function coverageWarnings(kapitoly, params) {
    const out = [];
    if (kapitoly.includes("OV_KaR") && karCutoffRelevant(params))
        out.push(KAR_COVERAGE_WARNING);
    if (params.kapitolaGroup === "insolvency")
        out.push(DOCH_NOTE);
    return out;
}
/** Whether the query reaches past the last OV_KaR notice. */
function karCutoffRelevant(params) {
    const cutoff = parseOvDate(OV_KAR_LAST_NOTICE);
    if (params.date)
        return parseOvDate(params.date) > cutoff;
    if (params.year)
        return Number(params.year) >= Number(OV_KAR_LAST_NOTICE.slice(-4));
    return true;
}
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
 * proceedings found" rather than "one chapter answered nothing". All chapters
 * empty is no safer: it is what the gazette holds, not proof that no
 * proceedings exist.
 */
export function buildKapitolaWarnings(breakdown) {
    const out = [];
    const empty = breakdown.filter((b) => b.rowCount === 0);
    const names = (list) => list.map((b) => `${b.kapitola} (${b.label})`).join(", ");
    if (empty.length > 0 && empty.length === breakdown.length) {
        out.push(`Žiadna z kapitol ${names(empty)} nevrátila k tomuto dopytu záznam. Je to odpoveď ` +
            "Obchodného vestníka, nie dôkaz, že konanie neexistuje — skontroluj ostatné " +
            "varovania o pokrytí kapitol a príslušný register.");
    }
    else if (empty.length > 0) {
        out.push(`Kapitoly ${names(empty)} nevrátili k tomuto dopytu žiadny záznam, kým ostatné áno. ` +
            "Výsledok preto nemožno čítať ako úplný — over si tieto kapitoly samostatne " +
            "cez ov_search s parametrom kapitola.");
    }
    const truncated = breakdown.filter((b) => b.truncated);
    if (truncated.length > 0) {
        out.push(`Kapitoly ${names(truncated)} majú ďalšie strany. rowCount a newest v kapitolyDetail ` +
            "sa týkajú len vrátenej strany — ďalšie záznamy získaš parametrom page.");
    }
    return out.length > 0 ? out : undefined;
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
function validateSearchForm(html) {
    parseViewStateTokens(html);
    if (!/<table[^>]*id=["'][^"']*gvVyhladavanieOV[^"']*["']/i.test(html))
        throw new OvSourceError("OV_SCHEMA", "OV result table marker is missing.");
}
function validateSearchRows(rows) {
    if (rows.length > MAX_ROWS)
        throw new OvSourceError("OV_SCHEMA", "OV result count exceeds its bound.");
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
}
/** Filter fields of the search form, shared by the search and the pager postback. */
function searchFormBody(tokens, params) {
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
    setField(body, "cmbKapitola", params.kapitola ?? "");
    setField(body, "hfKapitola", params.kapitola ?? "");
    setField(body, "cmbTypPodania", "");
    if (params.date) {
        // The radio's value is the control id; "rbDen" matched no option, so the
        // source ignored the date and returned other days.
        setField(body, "DatumZverejnenia", "rbDatumZverejneniaDen");
        setField(body, "txtDatumZverejnenia", params.date);
    }
    return body;
}
function emptyResult(params, kapitola, pageCount) {
    return {
        query: pruneUndefined({ ...params, kapitola, kapitolaGroup: undefined }),
        page: params.page ?? 1,
        countOnPage: params.countOnPage ?? 10,
        rowCount: 0,
        rows: [],
        pageCount,
        sourceTotal: null,
        truncated: false,
        truncationReason: null,
        kapitolyDetail: [],
        warnings: [],
    };
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
