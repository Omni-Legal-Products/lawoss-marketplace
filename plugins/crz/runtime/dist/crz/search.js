import * as cheerio from "cheerio";
import { CRZ_BASE_URL, httpGet } from "./client.js";
import { cacheGet, cacheSet, TTL } from "./cache.js";
import { parseEuroAmount } from "./money.js";
const MONTHS_SK = {
    "január": "01", "januar": "01",
    "február": "02", "februar": "02",
    "marec": "03",
    "apríl": "04", "april": "04",
    "máj": "05", "maj": "05",
    "jún": "06", "jun": "06",
    "júl": "07", "jul": "07",
    "august": "08",
    "september": "09",
    "október": "10", "oktober": "10",
    "november": "11",
    "december": "12",
};
function fmtIsoDate(day, month, year) {
    const dd = day.replace(/[^0-9]/g, "").padStart(2, "0");
    const mm = MONTHS_SK[month.toLowerCase()] ?? "";
    const yyyy = year.replace(/[^0-9]/g, "");
    if (!dd || !mm || yyyy.length !== 4)
        return undefined;
    return `${yyyy}-${mm}-${dd}`;
}
function clean(s) {
    if (s == null)
        return undefined;
    const t = s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
    return t.length ? t : undefined;
}
// The CRZ advanced-search form posts to this canonical path. Both /zmluvy/?q=... and
// this URL list the same records, but the canonical path is the only one that
// reliably accepts the full set of `art_*` filter fields, so we always use it.
const SEARCH_PATH = "/2171273-sk/centralny-register-zmluv/";
export function buildSearchUrl(params) {
    const u = new URL(`${CRZ_BASE_URL}${SEARCH_PATH}`);
    const qs = u.searchParams;
    if (params.q)
        qs.set("art_predmet", params.q);
    if (params.dodavatel)
        qs.set("art_zs2", params.dodavatel);
    if (params.objednavatel)
        qs.set("art_zs1", params.objednavatel);
    if (params.ico)
        qs.set("art_ico", params.ico);
    if (params.cislo_zmluvy)
        qs.set("nazov", params.cislo_zmluvy);
    if (params.rezort)
        qs.set("art_rezort", params.rezort);
    if (params.cena_min != null)
        qs.set("art_suma_spolu_od", String(params.cena_min));
    if (params.cena_max != null)
        qs.set("art_suma_spolu_do", String(params.cena_max));
    const od = isoToDdMmYyyy(params.datum_od);
    const dop = isoToDdMmYyyy(params.datum_do);
    if (od)
        qs.set("art_datum_zverejnene_od", od);
    if (dop)
        qs.set("art_datum_zverejnene_do", dop);
    // Convert 1-based user page to 0-based CRZ page.
    const userPage = Math.max(1, params.page ?? 1);
    if (userPage > 1)
        qs.set("page", String(userPage - 1));
    return u.toString();
}
function isoToDdMmYyyy(s) {
    if (!s)
        return undefined;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m)
        return undefined;
    return `${m[3]}.${m[2]}.${m[1]}`;
}
// CRZ renders a fixed 20 rows per result page.
const PAGE_SIZE = 20;
export function parseSearchHtml(html, page) {
    const $ = cheerio.load(html);
    const rows = [];
    const hasResultsTable = $("table.table_list").length > 0;
    // Every valid CRZ search page renders the advanced-search form. A zero-result
    // search returns the form WITHOUT a results table — that's legitimate, not a
    // layout break. We use the form as the "this is still a CRZ search page" anchor.
    const hasSearchForm = $("#frm_filter_3").length > 0 || $("[name='art_predmet']").length > 0;
    $("table.table_list tbody tr").each((_, tr) => {
        const $tr = $(tr);
        const link = $tr.find("td.cell2 a[href^='/zmluva/']").first();
        if (!link.length)
            return;
        const href = link.attr("href") ?? "";
        const idMatch = /\/zmluva\/(\d+)\//.exec(href);
        if (!idMatch)
            return;
        const id = idMatch[1];
        const nazov = clean(link.text()) ?? "";
        const cislo = clean($tr.find("td.cell2 span").first().text());
        const dateSpans = $tr.find("td.cell1 span").toArray().map((el) => clean($(el).text()) ?? "");
        const datum = dateSpans.length >= 3 ? fmtIsoDate(dateSpans[0], dateSpans[1], dateSpans[2]) : undefined;
        const cena = clean($tr.find("td.cell3").text());
        const dodavatel = clean($tr.find("td.cell4").text());
        const objednavatel = clean($tr.find("td.cell5").text());
        rows.push({
            id,
            url: `${CRZ_BASE_URL}/zmluva/${id}/`,
            nazov,
            cislo,
            datum,
            cena,
            cena_eur: parseEuroAmount(cena),
            dodavatel,
            objednavatel,
        });
    });
    // Pagination: find the highest page number from pagination links
    let total_pages_hint;
    $("ul.pagination a, .pagination a").each((_, a) => {
        const n = parseInt(clean($(a).text()) ?? "", 10);
        if (!Number.isNaN(n)) {
            total_pages_hint = Math.max(total_pages_hint ?? 0, n);
        }
    });
    // A full page (20 rows) means there is very likely a next page. A short page
    // is the last one, so we stop — this avoids endlessly offering page+1.
    const next_page = rows.length >= PAGE_SIZE ? page + 1 : undefined;
    // Only flag a likely layout break when BOTH the results table and the search
    // form are missing. Three cases:
    //   table present                  → results (possibly zero rows) — fine
    //   no table, form present         → genuine zero-result search    — fine
    //   no table AND no form           → unexpected page/layout change  — warn
    const parser_warning = !hasResultsTable && !hasSearchForm
        ? "Neither the CRZ results table (table.table_list) nor the search form was found — the page layout may have changed and the scraper may need updating."
        : undefined;
    return {
        page,
        results: rows,
        next_page,
        total_pages_hint,
        parser_warning,
    };
}
/**
 * Fetch and parse a SINGLE CRZ result page (the raw ~20-row HTML page). This is
 * the cacheable unit; callers that need more rows compose several of these.
 * The `limit`/`page` fields on `params` are ignored here in favour of `page`.
 */
export async function fetchSearchPage(params, page) {
    const p = Math.max(1, page);
    // Cache key excludes paging-only fields so it is stable across callers.
    const { page: _p, limit: _l, ...filters } = params;
    const cacheKey = JSON.stringify({ ...filters, page: p });
    const cached = await cacheGet("search", cacheKey, TTL.SEARCH_MS);
    if (cached)
        return cached;
    const url = buildSearchUrl({ ...filters, page: p });
    const res = await httpGet(url);
    if (res.status >= 400) {
        throw new Error(`CRZ search returned ${res.status} for ${url}`);
    }
    const parsed = parseSearchHtml(res.text(), p);
    await cacheSet("search", cacheKey, parsed, TTL.SEARCH_MS);
    return parsed;
}
/**
 * Walk pages from `startPage`, accumulating rows until `limit` is reached or
 * pages run out. Pure over an injected `fetchPage` so it can be tested without
 * network. `maxPages` bounds the walk.
 */
export async function accumulateSearchPages(fetchPage, startPage, limit) {
    const collected = [];
    let page = startPage;
    let next_page;
    let total_pages_hint;
    let parser_warning;
    // Enough pages to fill the limit, plus a small margin.
    const maxPages = Math.ceil(limit / PAGE_SIZE) + 1;
    for (let i = 0; i < maxPages && collected.length < limit; i++) {
        const pageResult = await fetchPage(page);
        collected.push(...pageResult.results);
        if (pageResult.parser_warning && !parser_warning)
            parser_warning = pageResult.parser_warning;
        if (pageResult.total_pages_hint !== undefined) {
            total_pages_hint = Math.max(total_pages_hint ?? 0, pageResult.total_pages_hint);
        }
        next_page = pageResult.next_page;
        if (!next_page || pageResult.results.length === 0)
            break;
        page = next_page;
    }
    return {
        page: startPage,
        results: collected.slice(0, limit),
        // next_page points past the last page actually fetched: set when that page
        // was full (more rows exist), undefined when it was the last page.
        next_page,
        total_pages_hint,
        parser_warning,
    };
}
/**
 * Search contracts, walking as many CRZ pages as needed to collect up to
 * `limit` rows (CRZ renders a fixed ~20 rows per page, so a `limit` of 50 means
 * up to 3 pages are fetched). Starts at `params.page` (1-based). `next_page`
 * points past the last page actually fetched, so a caller can continue paging.
 */
export async function searchContracts(params) {
    const startPage = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    return accumulateSearchPages((page) => fetchSearchPage(params, page), startPage, limit);
}
//# sourceMappingURL=search.js.map