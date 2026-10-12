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
    if (params.ico) {
        // `ico` means "either party" and needs two CRZ queries; callers must split it
        // with `splitIcoQueries` first. Silently mapping it to one side was the bug.
        throw new Error("Internal: split `ico` into ico_dodavatel / ico_objednavatel before building a CRZ URL.");
    }
    const u = new URL(`${CRZ_BASE_URL}${SEARCH_PATH}`);
    const qs = u.searchParams;
    if (params.q)
        qs.set("art_predmet", params.q);
    if (params.dodavatel)
        qs.set("art_zs2", params.dodavatel);
    if (params.objednavatel)
        qs.set("art_zs1", params.objednavatel);
    // CRZ form: art_ico = "IČO dodávateľa", art_ico1 = "IČO objednávateľa".
    if (params.ico_dodavatel)
        qs.set("art_ico", params.ico_dodavatel);
    if (params.ico_objednavatel)
        qs.set("art_ico1", params.ico_objednavatel);
    if (params.cislo_zmluvy)
        qs.set("nazov", params.cislo_zmluvy);
    if (params.rezort)
        qs.set("art_rezort", params.rezort);
    if (params.cena_min != null)
        qs.set("art_suma_spolu_od", String(params.cena_min));
    if (params.cena_max != null)
        qs.set("art_suma_spolu_do", String(params.cena_max));
    const od = parseDateInput(params.datum_od, "datum_od");
    const dop = parseDateInput(params.datum_do, "datum_do");
    if (od)
        qs.set("art_datum_zverejnene_od", od.crz);
    if (dop)
        qs.set("art_datum_zverejnene_do", dop.crz);
    // Convert 1-based user page to 0-based CRZ page.
    const userPage = Math.max(1, params.page ?? 1);
    if (userPage > 1)
        qs.set("page", String(userPage - 1));
    return u.toString();
}
/**
 * Parse a user-supplied date. Accepts `YYYY-MM-DD` and the Slovak `DD.MM.YYYY`
 * (also `D.M.YYYY`). Anything else throws: an unparseable date must never
 * silently drop the filter.
 */
export function parseDateInput(value, field) {
    if (value == null)
        return undefined;
    const s = value.trim();
    if (!s)
        return undefined;
    let y, m, d;
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (match) {
        [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    }
    else if ((match = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(s))) {
        [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    }
    else {
        throw new Error(`Invalid ${field} "${value}": use YYYY-MM-DD (DD.MM.YYYY is also accepted).`);
    }
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
        throw new Error(`Invalid ${field} "${value}": not a calendar date.`);
    }
    const dd = String(d).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    return { iso: `${y}-${mm}-${dd}`, crz: `${dd}.${mm}.${y}` };
}
// CRZ renders a fixed 20 rows per result page.
const PAGE_SIZE = 20;
// CRZ shows at most this many page links at once.
const PAGINATION_WINDOW = 11;
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
    // A full page (20 rows) means there is very likely a next page. A short page
    // is the last one, so we stop — this avoids endlessly offering page+1.
    const next_page = rows.length >= PAGE_SIZE ? page + 1 : undefined;
    // CRZ never states the page count; it renders a sliding window of up to 11
    // page links. The highest visible number is the total only when the whole
    // range fits into the window (or when this is the last, short page).
    let highestVisible;
    $("ul.pagination a, .pagination a, ul.pagination span.page-link").each((_, a) => {
        const n = parseInt(clean($(a).clone().children().remove().end().text()) ?? "", 10);
        if (!Number.isNaN(n))
            highestVisible = Math.max(highestVisible ?? 0, n);
    });
    let total_pages_hint;
    let total_pages_at_least;
    if (rows.length > 0 && next_page === undefined) {
        // A short page is the last page with data. CRZ's links can over-count
        // (seen 2026-10-12: 4 links for art_ico=00320650, rows only on pages 1–2).
        total_pages_hint = page;
    }
    else if (highestVisible !== undefined && highestVisible < PAGINATION_WINDOW) {
        total_pages_hint = highestVisible;
    }
    else if (highestVisible !== undefined) {
        total_pages_at_least = Math.max(highestVisible, page);
    }
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
        total_pages_at_least,
        parser_warning,
    };
}
/**
 * Fetch and parse a SINGLE CRZ result page (the raw ~20-row HTML page). This is
 * the cacheable unit; callers that need more rows compose several of these.
 * The `limit`/`page`/`offset` fields on `params` are ignored in favour of `page`.
 */
export async function fetchSingleSearchPage(params, page) {
    const p = Math.max(1, page);
    // Cache key excludes paging-only fields so it is stable across callers.
    const { page: _p, limit: _l, offset: _o, ...filters } = params;
    // Build the URL first so invalid input fails before any cache lookup.
    const url = buildSearchUrl({ ...filters, page: p });
    const cacheKey = JSON.stringify({ ...filters, page: p });
    const cached = await cacheGet("search", cacheKey, TTL.SEARCH_MS);
    if (cached)
        return cached;
    const res = await httpGet(url);
    if (res.status >= 400) {
        throw new Error(`CRZ search returned ${res.status} for ${url}`);
    }
    const parsed = parseSearchHtml(res.text(), p);
    await cacheSet("search", cacheKey, parsed, TTL.SEARCH_MS);
    return parsed;
}
/**
 * CRZ has no "IČO of either party" filter: `art_ico` is the supplier and
 * `art_ico1` the contracting authority. An `ico` filter is therefore split into
 * two queries whose results the callers merge.
 */
export function splitIcoQueries(params) {
    const { ico, ...rest } = params;
    if (!ico)
        return [{ params: rest }];
    if (params.ico_dodavatel || params.ico_objednavatel) {
        throw new Error("Use either `ico` (either party) or `ico_dodavatel` / `ico_objednavatel`, not both.");
    }
    return [
        { params: { ...rest, ico_dodavatel: ico }, side: "dodavatel" },
        { params: { ...rest, ico_objednavatel: ico }, side: "objednavatel" },
    ];
}
function compareNewestFirst(a, b) {
    const da = a.datum ?? "";
    const db = b.datum ?? "";
    if (da !== db)
        return da < db ? 1 : -1;
    return Number(b.id) - Number(a.id);
}
/**
 * Merge rows from the per-side queries: dedupe by id, tag `ico_zhoda`, and
 * order newest first (ties by id) so the merged order is deterministic.
 */
export function mergeIcoRows(parts) {
    const byId = new Map();
    for (const part of parts) {
        for (const row of part.rows) {
            const prev = byId.get(row.id);
            if (!prev) {
                byId.set(row.id, part.side ? { ...row, ico_zhoda: part.side } : row);
            }
            else if (part.side && prev.ico_zhoda && prev.ico_zhoda !== part.side) {
                byId.set(row.id, { ...prev, ico_zhoda: "obe" });
            }
        }
    }
    return [...byId.values()].sort(compareNewestFirst);
}
/**
 * One logical result page. Without `ico` it is the raw CRZ page; with `ico` it
 * is page N of the supplier-side query merged with page N of the buyer-side
 * query (up to 40 rows). Walking all logical pages visits every row of both.
 */
export async function fetchLogicalPage(fetchSingle, params, page) {
    const queries = splitIcoQueries(params);
    if (queries.length === 1)
        return fetchSingle(queries[0].params, page);
    const pages = await Promise.all(queries.map((q) => fetchSingle(q.params, page)));
    const results = mergeIcoRows(queries.map((q, i) => ({ side: q.side, rows: pages[i].results })));
    const exact = pages.every((p) => p.total_pages_hint !== undefined);
    const bound = Math.max(0, ...pages.map((p) => p.total_pages_hint ?? p.total_pages_at_least ?? 0));
    return {
        page,
        results,
        next_page: pages.some((p) => p.next_page !== undefined) ? page + 1 : undefined,
        total_pages_hint: exact ? bound : undefined,
        total_pages_at_least: !exact && bound > 0 ? bound : undefined,
        parser_warning: pages.find((p) => p.parser_warning)?.parser_warning,
    };
}
/** Logical page fetch against the live CRZ (with cache). */
export async function fetchSearchPage(params, page) {
    return fetchLogicalPage(fetchSingleSearchPage, params, page);
}
/**
 * Walk pages from `startPage`, skipping the first `offset` rows of it, and
 * accumulate rows until `limit` is reached or pages run out. Pure over an
 * injected `fetchPage` so it can be tested without network.
 *
 * Continuation never leaves a gap: when the limit is reached in the middle of
 * a page, `next_page` is THAT page and `next_offset` the number of its rows
 * already returned.
 */
export async function accumulateSearchPages(fetchPage, startPage, limit, offset = 0) {
    const collected = [];
    let page = startPage;
    let skip = Math.max(0, Math.floor(offset));
    let next_page;
    let next_offset = 0;
    let total_pages_hint;
    let total_pages_at_least;
    let parser_warning;
    // Enough pages to fill the limit, plus a small margin.
    const maxPages = Math.ceil((limit + skip) / PAGE_SIZE) + 1;
    for (let i = 0; i < maxPages; i++) {
        const pageResult = await fetchPage(page);
        if (pageResult.parser_warning && !parser_warning)
            parser_warning = pageResult.parser_warning;
        if (pageResult.total_pages_hint !== undefined)
            total_pages_hint = pageResult.total_pages_hint;
        if (pageResult.total_pages_at_least !== undefined) {
            total_pages_at_least = Math.max(total_pages_at_least ?? 0, pageResult.total_pages_at_least);
        }
        const rows = pageResult.results.slice(skip);
        const room = limit - collected.length;
        if (rows.length > room) {
            collected.push(...rows.slice(0, room));
            next_page = page;
            next_offset = skip + room;
            break;
        }
        collected.push(...rows);
        skip = 0;
        next_page = pageResult.next_page;
        next_offset = 0;
        if (!next_page || pageResult.results.length === 0 || collected.length >= limit)
            break;
        page = next_page;
    }
    return {
        page: startPage,
        results: collected,
        next_page,
        next_offset: next_page !== undefined ? next_offset : undefined,
        total_pages_hint,
        total_pages_at_least: total_pages_hint === undefined ? total_pages_at_least : undefined,
        parser_warning,
    };
}
/** `searchContracts` over an injected single-page fetcher (testable without network). */
export async function searchContractsWith(fetchSingle, params) {
    const startPage = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    // Validate dates up front so a bad value is an error, never "no filter".
    parseDateInput(params.datum_od, "datum_od");
    parseDateInput(params.datum_do, "datum_do");
    return accumulateSearchPages((page) => fetchLogicalPage(fetchSingle, params, page), startPage, limit, params.offset ?? 0);
}
/**
 * Search contracts, walking as many CRZ pages as needed to collect up to
 * `limit` rows (CRZ renders a fixed ~20 rows per page). Starts at `params.page`
 * (1-based), skipping `params.offset` rows of it. Continue with
 * `page: next_page, offset: next_offset`.
 */
export async function searchContracts(params) {
    return searchContractsWith(fetchSingleSearchPage, params);
}
//# sourceMappingURL=search.js.map