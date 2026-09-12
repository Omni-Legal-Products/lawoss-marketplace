import { fetchSearchPage } from "./search.js";
/**
 * A row is "newer" than the watermark. Id comparison is preferred because CRZ
 * ids are monotonically increasing; date is the fallback when no id is known.
 */
export function isNewerRow(row, wm) {
    if (wm.sinceId != null && wm.sinceId !== "") {
        const a = Number(row.id);
        const b = Number(wm.sinceId);
        if (!Number.isNaN(a) && !Number.isNaN(b))
            return a > b;
    }
    if (wm.sinceDate) {
        return (row.datum ?? "") >= wm.sinceDate;
    }
    return true;
}
/**
 * All rows on a page that are newer than the watermark.
 *
 * NOTE: CRZ orders results by publication date, and within the same day the
 * contract ids are shuffled (not strictly descending). So we must NOT early-stop
 * at the first already-seen row — a newer id can sit below an older one on the
 * same page. New contracts (id > sinceId) form a contiguous block across the
 * freshest pages, so a page yielding zero new rows is the signal to stop.
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
/**
 * Newest contracts first (optionally filtered), walking as many pages as needed
 * to collect up to `limit` rows. CRZ's default ordering is publication-date
 * descending, so page 1 already holds the freshest contracts.
 */
export async function listRecent(filters, limit = 20) {
    const cap = Math.min(200, Math.max(1, limit));
    const out = [];
    let page = 1;
    let scanned = 0;
    let parser_warning;
    const maxPages = Math.ceil(cap / 20) + 2;
    while (out.length < cap && scanned < maxPages) {
        const r = await fetchSearchPage(filters, page);
        scanned++;
        if (r.parser_warning)
            parser_warning = r.parser_warning;
        out.push(...r.results);
        if (!r.next_page || r.results.length === 0)
            break;
        page = r.next_page;
    }
    return {
        results: out.slice(0, cap),
        scanned_pages: scanned,
        max_id: maxId(out),
        parser_warning,
    };
}
/**
 * Return contracts published since a watermark (a previously seen highest id
 * and/or a date). Walks newest-first pages until it crosses into already-seen
 * territory or hits `maxPages`. Returns `max_id` to use as the next watermark.
 */
export async function whatsNew(wm, opts = {}) {
    if ((wm.sinceId == null || wm.sinceId === "") && !wm.sinceDate) {
        throw new Error("Provide `since_id` and/or `since_date` to detect new contracts.");
    }
    const filters = opts.filters ?? {};
    const maxPages = Math.min(50, Math.max(1, opts.maxPages ?? 10));
    const collected = [];
    let page = 1;
    let scanned = 0;
    let parser_warning;
    while (scanned < maxPages) {
        const r = await fetchSearchPage(filters, page);
        scanned++;
        if (r.parser_warning)
            parser_warning = r.parser_warning;
        const newRows = filterNewRows(r.results, wm);
        collected.push(...newRows);
        // New contracts occupy the freshest pages contiguously; a page with zero new
        // rows means we've passed them. Stop here (or at the last page / page cap).
        if (newRows.length === 0 || !r.next_page || r.results.length === 0)
            break;
        page = r.next_page;
    }
    return {
        results: collected,
        scanned_pages: scanned,
        max_id: maxId(collected) ?? (wm.sinceId || undefined),
        parser_warning,
    };
}
//# sourceMappingURL=recent.js.map