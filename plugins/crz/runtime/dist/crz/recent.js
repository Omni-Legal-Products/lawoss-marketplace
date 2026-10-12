import { fetchSingleSearchPage, mergeIcoRows, parseDateInput, splitIcoQueries } from "./search.js";
/**
 * A row is "newer" than the watermark when it passes every criterion given:
 * id above `sinceId` and publication date on/after `sinceDate`.
 */
export function isNewerRow(row, wm) {
    if (wm.sinceId != null && wm.sinceId !== "") {
        const a = Number(row.id);
        const b = Number(wm.sinceId);
        if (!Number.isNaN(a) && !Number.isNaN(b) && a <= b)
            return false;
    }
    if (wm.sinceDate) {
        const iso = parseDateInput(wm.sinceDate, "since_date")?.iso ?? wm.sinceDate;
        if ((row.datum ?? "") < iso)
            return false;
    }
    return true;
}
/**
 * All rows on a page that are newer than the watermark. CRZ orders results by
 * publication date only; within a day ids are shuffled, so every row is checked
 * (no early stop at the first already-seen row).
 */
export function filterNewRows(rows, wm) {
    return rows.filter((row) => isNewerRow(row, wm));
}
function maxId(rows) {
    let best;
    let bestStr;
    for (const r of rows) {
        const n = Number(r.id);
        if (!Number.isNaN(n) && (best === undefined || n > best)) {
            best = n;
            bestStr = r.id;
        }
    }
    return bestStr;
}
function maxDatum(rows) {
    let best;
    for (const r of rows)
        if (r.datum && (best === undefined || r.datum > best))
            best = r.datum;
    return best;
}
function oldestDatum(rows) {
    let worst;
    for (const r of rows)
        if (r.datum && (worst === undefined || r.datum < worst))
            worst = r.datum;
    return worst;
}
/**
 * Newest contracts first (optionally filtered), walking as many pages as needed
 * to collect up to `limit` rows. With `ico` both sides are queried and merged.
 */
export async function listRecentWith(fetchSingle, filters, limit = 20) {
    const cap = Math.min(200, Math.max(1, limit));
    const maxPages = Math.ceil(cap / 20) + 2;
    const parts = [];
    let scanned = 0;
    let parser_warning;
    for (const query of splitIcoQueries(filters)) {
        const rows = [];
        let page = 1;
        let pagesForQuery = 0;
        while (rows.length < cap && pagesForQuery < maxPages) {
            const r = await fetchSingle(query.params, page);
            scanned++;
            pagesForQuery++;
            if (r.parser_warning)
                parser_warning = r.parser_warning;
            rows.push(...r.results);
            if (!r.next_page || r.results.length === 0)
                break;
            page = r.next_page;
        }
        parts.push({ side: query.side, rows: rows.slice(0, cap) });
    }
    const results = (parts.length === 1 ? parts[0].rows : mergeIcoRows(parts)).slice(0, cap);
    return {
        results,
        scanned_pages: scanned,
        max_id: maxId(results),
        max_datum: maxDatum(results),
        warnings: [],
        parser_warning,
    };
}
export function listRecent(filters, limit = 20) {
    return listRecentWith(fetchSingleSearchPage, filters, limit);
}
/**
 * Walk one query newest-first. CRZ sorts by publication date, so the scan can
 * stop once a page reaches rows older than the stop date:
 * - with `sinceDate`, the stop date is that date (deterministic);
 * - with only `sinceId`, it is the date of the first already-seen row. That is a
 *   heuristic (ids are not ordered by publication time), reported as such.
 */
async function scanSince(fetchSingle, params, wm, sinceIso, maxPages) {
    const rows = [];
    let stopDate = sinceIso;
    let page = 1;
    let scanned = 0;
    let parser_warning;
    while (scanned < maxPages) {
        const r = await fetchSingle(params, page);
        scanned++;
        if (r.parser_warning)
            parser_warning = r.parser_warning;
        rows.push(...filterNewRows(r.results, wm));
        if (!stopDate) {
            const firstSeen = r.results.find((row) => !isNewerRow(row, wm) && row.datum);
            if (firstSeen)
                stopDate = firstSeen.datum;
        }
        const oldest = oldestDatum(r.results);
        if (stopDate && oldest && oldest < stopDate)
            return { rows, scanned, reachedEnd: true, truncated: false, parser_warning };
        if (!r.next_page || r.results.length === 0)
            return { rows, scanned, reachedEnd: true, truncated: false, parser_warning };
        page = r.next_page;
    }
    return { rows, scanned, reachedEnd: false, truncated: true, parser_warning };
}
/**
 * Return contracts published since a watermark (a previously seen highest id
 * and/or a publication date). Reports `complete` / `truncated` explicitly so a
 * zero-row answer is never mistaken for "nothing new" when the scan was cut.
 */
export async function whatsNewWith(fetchSingle, wm, opts = {}) {
    const hasId = wm.sinceId != null && wm.sinceId !== "";
    if (!hasId && !wm.sinceDate) {
        throw new Error("Provide `since_id` and/or `since_date` to detect new contracts.");
    }
    const sinceIso = parseDateInput(wm.sinceDate, "since_date")?.iso;
    if (hasId && !/^\d+$/.test(String(wm.sinceId).trim())) {
        throw new Error(`Invalid since_id "${wm.sinceId}": expected a numeric CRZ contract id.`);
    }
    const filters = opts.filters ?? {};
    const maxPages = Math.min(50, Math.max(1, opts.maxPages ?? 10));
    const warnings = [];
    const parts = [];
    let scanned = 0;
    let truncated = false;
    let parser_warning;
    for (const query of splitIcoQueries(filters)) {
        const s = await scanSince(fetchSingle, query.params, wm, sinceIso, maxPages);
        scanned += s.scanned;
        truncated ||= s.truncated;
        if (s.parser_warning)
            parser_warning = s.parser_warning;
        parts.push({ side: query.side, rows: s.rows });
    }
    const results = parts.length === 1 ? parts[0].rows : mergeIcoRows(parts);
    if (truncated) {
        warnings.push(`Scan stopped at max_pages=${maxPages} (${maxPages * 20} rows per query) before reaching older contracts — the result is INCOMPLETE. Narrow the filters, raise max_pages (max 50) or check more often.`);
    }
    if (!sinceIso) {
        warnings.push("since_id alone cannot guarantee completeness: CRZ orders by publication date and contract ids are not issued in publication order, so a contract with an id below since_id may still be published later. Use since_date (the previous max_datum) and dedupe by id.");
    }
    if (parser_warning)
        warnings.push(parser_warning);
    return {
        results,
        scanned_pages: scanned,
        max_id: maxId(results) ?? (hasId ? String(wm.sinceId) : undefined),
        max_datum: maxDatum(results) ?? sinceIso,
        complete: !truncated && !!sinceIso && !parser_warning,
        truncated,
        warnings,
        parser_warning,
    };
}
export function whatsNew(wm, opts = {}) {
    return whatsNewWith(fetchSingleSearchPage, wm, opts);
}
//# sourceMappingURL=recent.js.map