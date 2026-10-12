export const DEFAULT_UVO_BASE_URL = "https://www.uvo.gov.sk";
const DEFAULT_BASE = DEFAULT_UVO_BASE_URL;
const SEARCH_PATH = "/vyhladavanie/vyhladavanie-zakaziek";
const NOTICE_PATH = "/vestnik-a-registre/vestnik/oznamenie/detail";
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const MAX_TEXT_FIELD_BYTES = 8 * 1024;
export const MAX_PAGES = 20;
export const MAX_ROWS = 2_000;
export const UPSTREAM_CONCURRENCY = 4;
export class UvoSourceError extends Error {
    code;
    transient;
    constructor(code, message, transient = false) {
        super(message);
        this.code = code;
        this.transient = transient;
        this.name = "UvoSourceError";
    }
}
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 uvo-mcp/0.1";
// ===========================================================================
// Pure parsing helpers (no network) — exercised directly by unit tests.
// ===========================================================================
export function decodeHtmlEntities(s) {
    return s
        .replace(/&#(\d+);/g, (_, d) => decodeNumericEntity(d, 10))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => decodeNumericEntity(h, 16))
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, " ");
}
function decodeNumericEntity(raw, radix) {
    const value = Number.parseInt(raw, radix);
    if (!Number.isSafeInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
        throw new UvoSourceError("UVO_SCHEMA", "UVO public source contains a malformed numeric entity.");
    }
    try {
        return String.fromCodePoint(value);
    }
    catch {
        throw new UvoSourceError("UVO_SCHEMA", "UVO public source contains a malformed numeric entity.");
    }
}
function stripTags(html) {
    return decodeHtmlEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
/** Convert "dd.mm.yyyy" to ISO "yyyy-mm-dd"; pass through anything else. */
export function toIsoDate(s) {
    if (!s)
        return "";
    const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
    if (!m)
        return s.trim();
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
/** Extract the numeric id from a /detail/{id} style link. */
function extractIdFromDetail(url) {
    const m = /\/detail\/(\d+)/.exec(url);
    return m ? m[1] : "";
}
/** Isolate the one table carrying both the UVO marker and result headings. */
function extractResultsTable(html) {
    const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)]
        .map((match) => match[0])
        .filter((table) => {
        const openingTag = /^<table\b[^>]*>/i.exec(table)?.[0] ?? "";
        const hasMarker = /\bid\s*=\s*["']zakazky-result-table["']/i.test(openingTag)
            || /\bclass\s*=\s*["'][^"']*\btable\b[^"']*["']/i.test(openingTag);
        const hasResultHeading = /(?:Názov\s+zákazky|Názov\s+obstarávateľa)/i.test(table);
        return hasMarker && hasResultHeading;
    });
    if (tables.length === 0)
        throw new UvoSourceError("UVO_SCHEMA", "UVO result table marker is missing.");
    if (tables.length !== 1)
        throw new UvoSourceError("UVO_SCHEMA", "UVO result table marker is ambiguous.");
    return tables[0];
}
/**
 * Parse the zákazky results <table> into structured rows.
 * Columns: Názov zákazky (link → zakazka detail), Názov obstarávateľa
 * (link → profil detail), Hlavné CPV, Hlavné NUTS, Aktualizácia, badge.
 * Pure: operates on an HTML string.
 */
export function parseSearchRows(html, base = DEFAULT_BASE) {
    const table = extractResultsTable(html);
    return parseSearchTableRows(table, base);
}
function parseSearchTableRows(table, base) {
    const rows = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(table)) !== null) {
        const rowHtml = rowMatch[1];
        // Skip header rows (no <td>).
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
        const zakazkaLink = extractHref(cells[0] ?? "", /vyhladavanie-zakaziek\/detail\//i);
        const zakazkaId = extractIdFromDetail(zakazkaLink);
        // Skip non-data rows that carry no contract detail link.
        if (!zakazkaId)
            continue;
        const authorityLink = extractHref(cells[1] ?? "", /vyhladavanie-profilov\/detail\//i);
        rows.push({
            zakazkaId,
            detailUrl: absolutize(zakazkaLink, base),
            title: stripTags(cells[0] ?? ""),
            authorityName: stripTags(cells[1] ?? ""),
            authorityProfileId: extractIdFromDetail(authorityLink),
            mainCpvLabel: stripTags(cells[2] ?? ""),
            nutsLabel: stripTags(cells[3] ?? ""),
            updated: toIsoDate(stripTags(cells[4] ?? "")),
            source: stripTags(cells[6] ?? cells[5] ?? ""),
        });
    }
    return rows;
}
function extractHref(cellHtml, mustMatch) {
    const re = /href=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(cellHtml)) !== null) {
        const url = decodeHtmlEntities(m[1]);
        if (mustMatch.test(url))
            return url;
    }
    return "";
}
function absolutize(url, base) {
    if (!url)
        return "";
    if (/^https?:\/\//i.test(url))
        return url;
    return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}
/** Parse the pagination <ul> for the current page and a next-page link. */
export function parsePagination(html, currentPage) {
    const next = /href=["']([^"']*pageNo=(\d+)[^"']*)["']/gi;
    let hasNext = false;
    let nextParam = null;
    let m;
    while ((m = next.exec(html)) !== null) {
        const pageNo = parseInt(m[2], 10);
        if (pageNo === currentPage + 1) {
            hasNext = true;
            nextParam = `pageNo=${pageNo}`;
            break;
        }
    }
    return { page: currentPage, hasNext, nextParam };
}
// ---------------------------------------------------------------------------
// Notice (oznámenie) detail parsing
// ---------------------------------------------------------------------------
/** Value of a `<span class="label">Label:</span><span>value</span>` pair. */
function labelSpanValue(html, label) {
    const re = new RegExp(`<span[^>]*class=["'][^"']*label[^"']*["'][^>]*>\\s*${escapeRegExp(label)}\\s*:?\\s*</span>\\s*<span[^>]*>([\\s\\S]*?)</span>`, "i");
    const m = re.exec(html);
    return m ? stripTags(m[1]) || undefined : undefined;
}
/** Value following a `<b>Label</b> value` inside a block (eForms numbering). */
function boldLabelValue(html, label) {
    const re = new RegExp(`<b>\\s*${escapeRegExp(label)}\\s*:?\\s*</b>\\s*([\\s\\S]*?)</div>`, "i");
    const m = re.exec(html);
    return m ? stripTags(m[1]) || undefined : undefined;
}
/** Value following a `<strong>Label:</strong> value` pair. */
function strongLabelValue(html, label) {
    const re = new RegExp(`<strong>\\s*${escapeRegExp(label)}\\s*:?\\s*</strong>\\s*([\\s\\S]*?)</div>`, "i");
    const m = re.exec(html);
    return m ? stripTags(m[1]) || undefined : undefined;
}
/** Value following a plain `<span>Label:</span><span>value</span>` pair. */
function spanPairValue(html, label) {
    const re = new RegExp(`<span[^>]*>\\s*${escapeRegExp(label)}\\s*:?\\s*</span>\\s*<span[^>]*>([\\s\\S]*?)</span>`, "i");
    const m = re.exec(html);
    return m ? stripTags(m[1]) || undefined : undefined;
}
/** Extract the content block immediately after a numbered subtitle, e.g. II.1.2). */
function blockAfterSubtitleCode(html, code) {
    const codeRe = code.replace(/\./g, "\\.").replace(/\)/g, "\\)");
    const re = new RegExp(`<div[^>]*class=["'][^"']*subtitle[^"']*["'][^>]*>[\\s\\S]*?<span[^>]*class=["'][^"']*code[^"']*["'][^>]*>\\s*${codeRe}\\s*</span>[\\s\\S]*?</div>\\s*([\\s\\S]*?)(?=<div[^>]*class=["'][^"']*subtitle|</fieldset>)`, "i");
    return re.exec(html)?.[1];
}
function valueAfterSubtitleCode(html, code) {
    const block = blockAfterSubtitleCode(html, code);
    return block ? stripTags(block) || undefined : undefined;
}
function valuesAfterSubtitleCode(html, code) {
    const block = blockAfterSubtitleCode(html, code);
    if (!block)
        return [];
    const values = [];
    const spanRe = /<span[^>]*>([\s\S]*?)<\/span>/gi;
    let m;
    while ((m = spanRe.exec(block)) !== null) {
        const value = stripTags(m[1]);
        if (value && !values.includes(value))
            values.push(value);
    }
    const stripped = stripTags(block);
    if (stripped && values.length === 0)
        values.push(stripped);
    return values.filter((value) => value && !/^[-–]?$/.test(value));
}
function cleanSubjectTitle(raw) {
    return raw?.replace(/\s*Referenčné číslo:.*$/i, "").trim() || undefined;
}
function referenceNumberValue(html) {
    const re = /Referenčné číslo:\s*<span[^>]*>([\s\S]*?)<\/span>/i;
    const m = re.exec(html);
    return m ? stripTags(m[1]) || undefined : undefined;
}
function placeNutsValue(html) {
    const block = /II\.2\.3\)[\s\S]*?(?=II\.2\.4\))/i.exec(html)?.[0] ?? "";
    return /\b(SK\d{3})\b/.exec(stripTags(block))?.[1];
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function parseEstimatedValue(raw) {
    if (!raw)
        return undefined;
    // e.g. "255 000,00 EUR bez DPH"
    const amountMatch = /([\d\s.]+,\d{2}|\d[\d\s]*)/.exec(raw);
    let amount = null;
    if (amountMatch) {
        const normalized = amountMatch[1]
            .replace(/\s/g, "")
            .replace(/\.(?=\d{3})/g, "")
            .replace(",", ".");
        const n = Number(normalized);
        amount = Number.isFinite(n) ? n : null;
    }
    const currency = /\b(EUR|USD|CZK|GBP)\b/.exec(raw)?.[1] ?? null;
    const vat = /(bez DPH|s DPH)/i.exec(raw)?.[1] ?? null;
    return { amount, currency, vat };
}
/**
 * Parse a notice-detail HTML page into structured fields.
 * Pure: operates on an HTML string. Parses by stable eForms labels (ODDIEL
 * I/II, I.x/II.x) and label-span pairs rather than DOM position.
 */
export function parseNoticeDetail(html, noticeId, sourceUrl) {
    const text = stripTags(html);
    // Header: "Oznámenie 740 - MUT"
    const noticeCode = /Oznámenie\s+(\d+\s*-\s*[A-ZÀ-Ž]+)/i
        .exec(text)?.[1]
        ?.replace(/\s*-\s*/, "-")
        .replace(/\s+/g, "");
    // "Vestník č. 6/2023 - 10.01.2023"
    const vestnikMatch = /Vestník\s+č\.\s*(\d+\/\d{4})\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4})/i.exec(text);
    const vestnikNumber = vestnikMatch?.[1];
    const publishedDate = vestnikMatch ? toIsoDate(vestnikMatch[2]) : undefined;
    // Notice type heading (the OZNÁMENIE ... line, often an <h2>).
    const mainHeaders = Array.from(html.matchAll(/<div[^>]*class=["'][^"']*MainHeader[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi), (m) => stripTags(m[1]));
    const noticeTypeTextMatches = Array.from(text.matchAll(/(OZNÁMENIE.*?)(?=\s+Druh postupu|\s+Druh zákazky|\s+ODDIEL)/gi), (m) => m[1].replace(/^.*\b(OZNÁMENIE)/i, "$1").trim());
    const noticeType = mainHeaders.find((header) => /^OZNÁMENIE/i.test(header)) ??
        noticeTypeTextMatches.at(-1);
    const procedureType = labelSpanValue(html, "Druh postupu") ?? strongLabelValue(html, "Druh postupu");
    const contractType = labelSpanValue(html, "Druh zákazky") ??
        strongLabelValue(html, "Druh zákazky") ??
        boldLabelValue(html, "II.1.3) Druh zákazky") ??
        valueAfterSubtitleCode(html, "II.1.3)");
    // ----- ODDIEL I: contracting authority -----
    const authority = {
        ico: labelSpanValue(html, "Vnútroštátne identifikačné číslo") ?? spanPairValue(html, "Vnútroštátne identifikačné číslo"),
        nuts: labelSpanValue(html, "Kód NUTS") ?? spanPairValue(html, "Kód NUTS"),
        email: labelSpanValue(html, "Email") ?? spanPairValue(html, "Email"),
        url: labelSpanValue(html, "Hlavná adresa(URL)") ??
            labelSpanValue(html, "Hlavná adresa") ??
            spanPairValue(html, "Hlavná adresa(URL)") ??
            spanPairValue(html, "Hlavná adresa"),
        authorityType: boldLabelValue(html, "I.4) DRUH VEREJNÉHO OBSTARÁVATEĽA") ??
            valuesAfterSubtitleCode(html, "I.4)").at(-1),
        mainActivity: boldLabelValue(html, "I.5) HLAVNÁ ČINNOSŤ") ?? valuesAfterSubtitleCode(html, "I.5)").at(-1),
    };
    // Authority name + address: support both older plain divs and current ContactSelectList markup.
    const namesBlock = blockAfterSubtitleCode(html, "I.1)") ?? /I\.1\)\s*NÁZOV A ADRESY[\s\S]{0,1200}/i.exec(html)?.[0] ?? "";
    const divRe = /<div[^>]*>([\s\S]*?)<\/div>/gi;
    const plainDivs = [];
    let dm;
    while ((dm = divRe.exec(namesBlock)) !== null) {
        const inner = dm[1];
        // Plain text div (no label-span, no <b>) → candidate name/address line.
        if (!/class=["'][^"']*label/i.test(inner) && !/<b>/i.test(inner) && !/<span/i.test(inner)) {
            const t = stripTags(inner);
            if (t)
                plainDivs.push(t);
        }
    }
    authority.name = /<span[^>]*class=["'][^"']*bold[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(namesBlock)
        ? stripTags(/<span[^>]*class=["'][^"']*bold[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(namesBlock)?.[1] ?? "")
        : plainDivs[0];
    authority.address = /<text[^>]*>([\s\S]*?)<\/text>/i.exec(namesBlock)
        ? stripTags(/<text[^>]*>([\s\S]*?)<\/text>/i.exec(namesBlock)?.[1] ?? "")
        : plainDivs[1];
    authority.country = /<span>\s*Slovensko\s*<\/span>/i.test(namesBlock) ? "Slovensko" : plainDivs[2];
    // ----- ODDIEL II: subject -----
    const additionalCpvRaw = boldLabelValue(html, "II.2.2) Dodatočné kódy CPV");
    const additionalCpvValues = valuesAfterSubtitleCode(html, "II.2.2)").filter((value) => /^\d{8}-\d$/.test(value));
    const placeNutsValues = valuesAfterSubtitleCode(html, "II.2.3)").filter((value) => /^SK\d{3}$/.test(value));
    const subject = {
        title: cleanSubjectTitle(boldLabelValue(html, "II.1.1) Názov") ?? valueAfterSubtitleCode(html, "II.1.1)")),
        referenceNumber: labelSpanValue(html, "Referenčné číslo") ?? spanPairValue(html, "Referenčné číslo") ?? referenceNumberValue(html),
        mainCpv: boldLabelValue(html, "II.1.2) Hlavný kód CPV") ?? valuesAfterSubtitleCode(html, "II.1.2)")[0],
        additionalCpv: additionalCpvRaw
            ? additionalCpvRaw.split(/[,;]\s*/).map((s) => s.trim()).filter(Boolean)
            : additionalCpvValues,
        shortDescription: boldLabelValue(html, "II.1.4) Stručný opis") ?? valueAfterSubtitleCode(html, "II.1.4)"),
        estimatedValue: parseEstimatedValue(boldLabelValue(html, "II.1.5) Celková odhadovaná hodnota") ?? valueAfterSubtitleCode(html, "II.1.5)")),
        placeNuts: boldLabelValue(html, "II.2.3) Miesto vykonania – Kód NUTS") ?? placeNutsValues[0] ?? placeNutsValue(html),
    };
    // Related zakazka id from any "dokumenty/{id}" or "/detail/{id}" doc link.
    const relatedZakazkaId = /dokumenty\/(\d+)/i.exec(html)?.[1] ??
        /vyhladavanie-zakaziek\/detail\/(\d+)/i.exec(html)?.[1];
    return {
        noticeId,
        noticeCode,
        vestnikNumber,
        publishedDate,
        noticeType,
        procedureType,
        contractType,
        contractingAuthority: authority,
        subject,
        relatedZakazkaId,
        sourceUrl,
    };
}
// ===========================================================================
// Client
// ===========================================================================
export class UvoClient {
    base;
    fetchImpl;
    timeoutMs;
    activeRequests = 0;
    waiters = [];
    constructor(opts = {}) {
        // `??` prepadne len na null/undefined. Keby compose poslal premennú
        // NASTAVENÚ, ALE PRÁZDNU (tvar "${UVO_BASE_URL:-}"), base by bola "" a každé
        // volanie by skončilo na fetch("/...") s hláškou "Failed to parse URL".
        // Presne tak dnes vypadol Register úpadcov (RU-MCP#8).
        this.base = normalizeBaseUrl(opts.baseUrl?.trim() || process.env.UVO_BASE_URL?.trim() || DEFAULT_BASE);
        this.fetchImpl = opts.fetchImpl ?? fetch;
        // Responses are large and one IČO query timed out at 30s before succeeding
        // at <70s — use a generous default timeout.
        this.timeoutMs = opts.timeoutMs ?? 90000;
    }
    get canonicalOrigin() {
        return new URL(this.base).origin;
    }
    async withTimeout(fn) {
        const ctrl = new AbortController();
        let timer;
        const timeout = new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
                ctrl.abort();
                reject(new UvoSourceError("UVO_TIMEOUT", "UVO public source request timed out.", true));
            }, this.timeoutMs);
        });
        try {
            return await Promise.race([fn(ctrl.signal), timeout]);
        }
        catch (error) {
            if (error instanceof UvoSourceError)
                throw error;
            if (isAbortError(error))
                throw new UvoSourceError("UVO_TIMEOUT", "UVO public source request timed out.", true);
            throw new UvoSourceError("UVO_HTTP", "UVO public source request failed.", true);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    async acquireRequestSlot() {
        if (this.activeRequests >= UPSTREAM_CONCURRENCY)
            await new Promise((resolve) => this.waiters.push(resolve));
        this.activeRequests += 1;
    }
    releaseRequestSlot() {
        this.activeRequests -= 1;
        this.waiters.shift()?.();
    }
    async request(initialUrl, redirectAllowed) {
        return this.withTimeout(async (signal) => {
            let currentUrl;
            try {
                currentUrl = new URL(initialUrl);
            }
            catch {
                throw new UvoSourceError("UVO_INPUT", "UVO source URL is invalid.");
            }
            const initialOrigin = currentUrl.origin;
            for (let hop = 0; hop <= 1; hop += 1) {
                await this.acquireRequestSlot();
                try {
                    const response = await this.fetchImpl(currentUrl.href, {
                        method: "GET", redirect: "manual", headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, signal,
                    });
                    if (isRedirectStatus(response.status)) {
                        const location = response.headers.get("location");
                        if (!location || hop === 1)
                            throw new UvoSourceError("UVO_HTTP", "UVO public source redirect was rejected.");
                        let next;
                        try {
                            next = new URL(location, currentUrl);
                        }
                        catch {
                            throw new UvoSourceError("UVO_HTTP", "UVO public source redirect was rejected.");
                        }
                        if (next.origin !== initialOrigin || next.username || next.password || (redirectAllowed && !redirectAllowed(next)))
                            throw new UvoSourceError("UVO_HTTP", "UVO public source redirect was rejected.");
                        currentUrl = next;
                        continue;
                    }
                    if (response.status !== 200)
                        throw new UvoSourceError("UVO_HTTP", "UVO public source returned a non-success status.", response.status >= 500);
                    const contentType = response.headers.get("content-type") ?? "";
                    if (!/^text\/html(?:\s*;|$)/i.test(contentType))
                        throw new UvoSourceError("UVO_CONTENT_TYPE", "UVO public source returned an unsupported content type.");
                    const buffer = await readBoundedResponse(response, MAX_RESPONSE_BYTES);
                    return { html: buffer.toString("utf8"), finalUrl: currentUrl.href };
                }
                finally {
                    this.releaseRequestSlot();
                }
            }
            throw new UvoSourceError("UVO_HTTP", "UVO public source redirect was rejected.");
        });
    }
    /** Build the search query string from params. */
    buildSearchUrl(params) {
        validateSearchParams(params);
        const qs = new URLSearchParams();
        if (params.ico)
            qs.set("obstarIco", params.ico);
        if (params.authorityName)
            qs.set("obstarNazov", params.authorityName);
        if (params.contractName)
            qs.set("nazovZakazky", params.contractName);
        if (params.cpv)
            qs.set("cpv", params.cpv);
        if (params.nuts)
            qs.set("nut", params.nuts);
        if (params.contractType)
            qs.set("druhZakazky", params.contractType);
        if (params.updatedWithinDays)
            qs.set("datumAktualizacie", String(params.updatedWithinDays));
        qs.set("pageNo", String(params.page ?? 1));
        return `${this.base}${SEARCH_PATH}?${qs.toString()}`;
    }
    /** uvo_search: GET the server-rendered HTML results table and parse it. */
    async search(params) {
        validateSearchParams(params);
        const page = params.page ?? 1;
        const url = this.buildSearchUrl(params);
        const { html } = await this.request(url);
        const resultsTable = extractResultsTable(html);
        const results = parseSearchTableRows(resultsTable, this.base);
        const pagination = parsePagination(html, page);
        const resultCount = validateSearchDocument(html, results, this.base);
        const truncated = pagination.hasNext || resultCount > results.length;
        return {
            query: pruneUndefined({ ...params, page }),
            resultCount,
            results,
            pagination,
            sourceUrl: url,
            page,
            pageSize: Math.max(results.length, 20),
            truncated,
            truncationReason: truncated ? "source_has_more_rows" : null,
            warnings: [],
        };
    }
    /**
     * uvo_get_notice: GET the oznámenie detail HTML (following the legacy 308
     * redirect) and extract structured fields.
     */
    async getNotice(noticeId) {
        if (!/^[1-9]\d{0,15}$/.test(noticeId))
            throw new UvoSourceError("UVO_INPUT", "Notice identifier is invalid.");
        const sourceUrl = `${this.base}${NOTICE_PATH}/${noticeId}`;
        const expectedPath = `${NOTICE_PATH}/${noticeId}`;
        const { html } = await this.request(sourceUrl, (target) => target.pathname === expectedPath && !target.search && !target.hash);
        validateNoticeDocument(html, noticeId);
        return capNoticeDetail(parseNoticeDetail(html, noticeId, sourceUrl));
    }
}
function normalizeBaseUrl(value) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new UvoSourceError("UVO_INPUT", "UVO base URL is invalid.");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash)
        throw new UvoSourceError("UVO_INPUT", "UVO base URL is invalid.");
    return parsed.href.replace(/\/+$/, "");
}
function validateSearchParams(params) {
    const text = [params.authorityName, params.contractName, params.cpv, params.nuts];
    if (text.some((value) => value !== undefined && (!value.trim() || Buffer.byteLength(value, "utf8") > 256)))
        throw new UvoSourceError("UVO_INPUT", "UVO search input is invalid.");
    if (params.ico !== undefined && !/^\d{8}$/.test(params.ico))
        throw new UvoSourceError("UVO_INPUT", "IČO is invalid.");
    if (params.page !== undefined && (!Number.isSafeInteger(params.page) || params.page < 1 || params.page > MAX_PAGES))
        throw new UvoSourceError("UVO_INPUT", "UVO page is invalid.");
    if (!params.ico && !params.authorityName && !params.contractName && !params.cpv && !params.nuts)
        throw new UvoSourceError("UVO_INPUT", "UVO search criterion is required.");
}
function parseSourceTotal(html) {
    const candidates = [
        /class=["'][^"']*\bpag-info\b[^"']*["'][\s\S]*?<span[^>]*>\s*([0-9][0-9\s]*)\s*z[áa]znamov\b/i,
        /(?:Celkový\s+počet\s+(?:záznamov|výsledkov)|Počet\s+(?:záznamov|výsledkov))\s*:?\s*<[^>]*>?\s*([0-9][0-9\s]*)/i,
        /(?:Celkový\s+počet\s+(?:záznamov|výsledkov)|Počet\s+(?:záznamov|výsledkov))\s*:?\s*([0-9][0-9\s]*)/i,
        /id=["'][^"']*(?:result-count|pocet|count|total)[^"']*["'][^>]*>\s*([^<]+)/i,
    ];
    for (const candidate of candidates) {
        const digits = candidate.exec(html)?.[1]?.replace(/\s+/g, "");
        if (digits && /^\d+$/.test(digits)) {
            const value = Number(digits);
            if (Number.isSafeInteger(value) && value >= 0)
                return value;
        }
    }
    return undefined;
}
function validateSearchDocument(html, rows, base) {
    const total = parseSourceTotal(html);
    if (total === undefined)
        throw new UvoSourceError("UVO_SCHEMA", "UVO explicit result count is missing.");
    if (rows.length > total || (total > 0 && rows.length === 0) || rows.length > MAX_ROWS)
        throw new UvoSourceError("UVO_SCHEMA", "UVO result count contradicts the source count.");
    const seen = new Set();
    for (const row of rows) {
        if (!/^\d+$/.test(row.zakazkaId) || seen.has(row.zakazkaId))
            throw new UvoSourceError("UVO_SCHEMA", "UVO result identifier is invalid.");
        seen.add(row.zakazkaId);
        let detail;
        try {
            detail = new URL(row.detailUrl);
        }
        catch {
            throw new UvoSourceError("UVO_SCHEMA", "UVO result detail URL is invalid.");
        }
        const expectedOrigin = new URL(base).origin;
        if (detail.origin !== expectedOrigin || detail.pathname !== `${SEARCH_PATH}/detail/${row.zakazkaId}` || detail.username || detail.password || detail.hash || [...detail.searchParams.keys()].some((key) => key !== "cHash")) {
            throw new UvoSourceError("UVO_SCHEMA", "UVO result detail URL is invalid.");
        }
        if (row.authorityProfileId && !/^\d+$/.test(row.authorityProfileId))
            throw new UvoSourceError("UVO_SCHEMA", "UVO authority profile identifier is invalid.");
        for (const value of Object.values(row))
            if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_TEXT_FIELD_BYTES)
                throw new UvoSourceError("UVO_SCHEMA", "UVO result field exceeds its bound.");
    }
    return total;
}
function validateNoticeDocument(html, noticeId) {
    const marker = /<h1[^>]*>\s*Oznámenie\s+\d+/i.test(html) && /ODDIEL\s+I\s*:/i.test(html) && /ODDIEL\s+II\s*:/i.test(html);
    if (!marker || !noticeId)
        throw new UvoSourceError("UVO_SCHEMA", "UVO notice detail marker is missing.");
}
function capText(value) {
    if (typeof value !== "string")
        throw new UvoSourceError("UVO_SCHEMA", "UVO public field is invalid.");
    if (Buffer.byteLength(value, "utf8") <= MAX_TEXT_FIELD_BYTES)
        return value;
    let output = value;
    while (Buffer.byteLength(output, "utf8") > MAX_TEXT_FIELD_BYTES)
        output = output.slice(0, -1);
    return output;
}
const capOptional = (value) => value === undefined ? undefined : capText(value);
function capNoticeDetail(detail) {
    const amount = detail.subject.estimatedValue?.amount;
    if (amount !== undefined && amount !== null && !Number.isFinite(amount))
        throw new UvoSourceError("UVO_SCHEMA", "UVO estimated value is invalid.");
    return {
        noticeId: detail.noticeId,
        noticeCode: capOptional(detail.noticeCode), vestnikNumber: capOptional(detail.vestnikNumber), publishedDate: capOptional(detail.publishedDate),
        noticeType: capOptional(detail.noticeType), procedureType: capOptional(detail.procedureType), contractType: capOptional(detail.contractType),
        contractingAuthority: Object.fromEntries(Object.entries(detail.contractingAuthority).map(([key, value]) => [key, value === undefined ? undefined : capText(value)])),
        subject: {
            title: capOptional(detail.subject.title), referenceNumber: capOptional(detail.subject.referenceNumber), mainCpv: capOptional(detail.subject.mainCpv),
            additionalCpv: detail.subject.additionalCpv.slice(0, 256).map(capText), shortDescription: capOptional(detail.subject.shortDescription),
            ...(detail.subject.estimatedValue ? { estimatedValue: { amount: detail.subject.estimatedValue.amount, currency: detail.subject.estimatedValue.currency === null ? null : capText(detail.subject.estimatedValue.currency), vat: detail.subject.estimatedValue.vat === null ? null : capText(detail.subject.estimatedValue.vat) } } : {}),
            placeNuts: capOptional(detail.subject.placeNuts),
        },
        relatedZakazkaId: capOptional(detail.relatedZakazkaId), sourceUrl: detail.sourceUrl,
    };
}
function isRedirectStatus(status) { return [301, 302, 303, 307, 308].includes(status); }
function isAbortError(error) {
    return error instanceof DOMException && error.name === "AbortError"
        || Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}
async function readBoundedResponse(response, maximumBytes) {
    const declared = response.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes))
        throw new UvoSourceError("UVO_SCHEMA", "UVO public source response exceeded its size bound.");
    if (!response.body)
        return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const next = await reader.read();
        if (next.done)
            break;
        const chunk = Buffer.from(next.value);
        total += chunk.length;
        if (total > maximumBytes) {
            void reader.cancel().catch(() => undefined);
            throw new UvoSourceError("UVO_SCHEMA", "UVO public source response exceeded its size bound.");
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
}
function pruneUndefined(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined && v !== "")
            out[k] = v;
    }
    return out;
}
