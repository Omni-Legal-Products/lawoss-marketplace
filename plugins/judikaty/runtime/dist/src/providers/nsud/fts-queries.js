/**
 * FTS5 query construction shared by the in-process store path and the query
 * worker. Both must build byte-identical SQL, otherwise offloading a search to
 * the worker would silently change results — so the SQL lives here once.
 */
/** Clamp caller-supplied paging/snippet knobs to the same bounds on both paths. */
export function normalizeFtsParams(input) {
    return {
        limit: Math.max(1, Math.min(100, input.limit)),
        offset: Math.max(0, input.offset),
        around: Math.max(4, Math.min(32, input.snippetCharsAround ?? 12))
    };
}
/** Providers whose texts live in `provider_texts` (NS has its own table). */
export const PROVIDER_TEXT_PROVIDERS = ["ustavny", "justice"];
/**
 * Over-fetch factor used when a subset of providers is requested. The provider
 * filter cannot go into the SQL (see `planProviderFtsQuery`), so we take more
 * rows than asked for and narrow them afterwards.
 */
/**
 * Raised from 8x/200 after measuring: with the old cap, `providers:["justice"]` returned
 * nothing whenever ÚS dominated the top of the ranking, because the narrowing happens
 * after the fetch. An unfiltered provider query costs ~220ms, so taking far more rows is
 * affordable — and it is the only lever available while the filter cannot go into the SQL
 * (695 seconds if it does). The exact fix is a `provider` column inside the FTS index,
 * which needs the index rebuilt.
 */
const POST_FILTER_OVERFETCH = 40;
const POST_FILTER_MAX_ROWS = 1000;
/**
 * Decide how to run a provider-text search.
 *
 * `AND pt.provider IN (...)` must never reach SQLite. Measured on the production
 * corpus (2026-08-03): the identical query takes 220ms unfiltered and **695
 * seconds** with the filter, because the filter flips the planner off the FTS
 * match and onto a scan of `provider_texts` and its 1.6GB of text. Since
 * search_decision_text always passed a provider list — `["ustavny","justice"]`
 * when the caller specified none, which filters nothing — every full-text search
 * paid that cost, which is what took the server down.
 *
 * So the filter is applied in JS instead. When every provider is requested there
 * is nothing to narrow; otherwise we over-fetch and narrow afterwards, which can
 * return fewer than `limit` rows if the excluded provider dominates the ranking —
 * reported as `truncated` rather than hidden.
 */
export function planProviderFtsQuery(input) {
    const match = sanitizeFtsQuery(input.query);
    if (!match)
        return null;
    const { limit, offset, around } = normalizeFtsParams(input);
    const requested = input.providers && input.providers.length > 0 ? new Set(input.providers) : null;
    const narrows = requested !== null && PROVIDER_TEXT_PROVIDERS.some((provider) => !requested.has(provider));
    const fetchLimit = narrows ? Math.min(POST_FILTER_MAX_ROWS, limit * POST_FILTER_OVERFETCH) : limit;
    return {
        sql: buildProviderFtsSql({ around, providerCount: 0 }),
        params: [match, fetchLimit, offset],
        postFilter: narrows ? requested : null,
        limit
    };
}
export function buildProviderFtsSql(input) {
    const providerFilter = input.providerCount > 0
        ? ` AND pt.provider IN (${Array.from({ length: input.providerCount }, () => "?").join(", ")})`
        : "";
    return `
    SELECT pt.provider AS provider,
           pt.id AS id,
           snippet(provider_texts_fts, 0, '[[', ']]', '…', ${input.around}) AS snippet,
           bm25(provider_texts_fts) AS rank
    FROM provider_texts_fts
    JOIN provider_texts pt ON pt.rowid = provider_texts_fts.rowid
    WHERE provider_texts_fts MATCH ?${providerFilter}
    ORDER BY rank
    LIMIT ? OFFSET ?
  `;
}
export function buildNsudFtsSql(input) {
    return `
    SELECT d.id AS id,
           r.ecli AS ecli,
           r.spisova_znacka AS spisova_znacka,
           r.date_issued AS date_issued,
           snippet(decisions_fts, 0, '[[', ']]', '…', ${input.around}) AS snippet,
           bm25(decisions_fts) AS rank
    FROM decisions_fts
    JOIN decisions d ON d.rowid = decisions_fts.rowid
    LEFT JOIN records r ON r.id = d.id
    WHERE decisions_fts MATCH ?
    ORDER BY rank
    LIMIT ? OFFSET ?
  `;
}
export function mapProviderFtsRows(rows) {
    return rows.map((row) => ({
        provider: row.provider,
        id: row.id,
        snippet: row.snippet,
        rank: row.rank
    }));
}
export function mapNsudFtsRows(rows) {
    return rows.map((row) => ({
        id: row.id,
        ecli: row.ecli,
        spisovaZnacka: row.spisova_znacka,
        dateIssued: row.date_issued,
        snippet: row.snippet,
        rank: row.rank
    }));
}
/**
 * Build a safe FTS5 MATCH expression from a free-text user query.
 *
 * Strips FTS5-significant punctuation, then appends a prefix-match suffix to
 * every token so that Slovak inflections work without the caller having to
 * spell out every grammatical case ("zalob" matches "zalobca", "zalobcu",
 * "zalobcov", "zalobou", ...). Tokens are joined with AND so multi-word
 * queries require all terms to be present.
 *
 * For phrase queries the caller can wrap the query in double quotes; the
 * sanitizer treats anything inside matching pairs as a single phrase token
 * that is matched exactly (no prefix suffix) so e.g. `"obciansky zakonnik"`
 * still works.
 */
export function sanitizeFtsQuery(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    const tokens = [];
    let cursor = 0;
    while (cursor < trimmed.length) {
        while (cursor < trimmed.length && /\s/.test(trimmed[cursor]))
            cursor += 1;
        if (cursor >= trimmed.length)
            break;
        if (trimmed[cursor] === '"') {
            const end = trimmed.indexOf('"', cursor + 1);
            if (end === -1) {
                // unterminated quote — treat the rest as a phrase
                const phrase = trimmed.slice(cursor + 1).replaceAll(/[*()]/g, " ").trim();
                if (phrase.length > 0)
                    tokens.push(`"${phrase}"`);
                break;
            }
            const phrase = trimmed.slice(cursor + 1, end).replaceAll(/[*()]/g, " ").trim();
            if (phrase.length > 0)
                tokens.push(`"${phrase}"`);
            cursor = end + 1;
            continue;
        }
        let end = cursor;
        while (end < trimmed.length && !/\s/.test(trimmed[end]))
            end += 1;
        // FTS5 only recognizes alphanumeric/CJK/letter codepoints inside an
        // unquoted token. Strip operator characters; everything else (including
        // diacritics) is normalized by the unicode61 tokenizer.
        const word = trimmed
            .slice(cursor, end)
            .replaceAll(/[*"()\-+:^]/g, "")
            .trim();
        if (word.length > 1) {
            tokens.push(`${word}*`);
        }
        cursor = end;
    }
    if (tokens.length === 0)
        return null;
    return tokens.join(" AND ");
}
//# sourceMappingURL=fts-queries.js.map