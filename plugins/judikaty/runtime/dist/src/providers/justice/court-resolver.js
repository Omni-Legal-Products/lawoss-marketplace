import { createTtlCache } from "../../infra/ttl-cache.js";
import { classifyCourtType, courtNamesMatch, courtTypesAreCompatible, normalizeCourtNameForMatch } from "../../domain/court-name-match.js";
/**
 * Court names change essentially never (new courts are a rare legislative
 * event, not a routine data update), so a long TTL is safe: staleness risk
 * is negligible, while the alternative -- resolving on every
 * search_decisions(courtName=...) call -- would add one upstream request
 * per search for no benefit. 24h also self-heals within a day if the
 * ministry ever does restructure a court, without requiring a redeploy.
 *
 * Only NON-EMPTY results are cached (see the `candidates.length === 0`
 * branch in `queryAutocomplete` below) -- a transient upstream hiccup that
 * happens to return zero rows must not pin a genuinely valid court name as
 * not-found for the full 24h in this process.
 */
const COURT_AUTOCOMPLETE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const COURT_AUTOCOMPLETE_CACHE_MAX_ENTRIES = 500;
const COURT_AUTOCOMPLETE_LIMIT = 20;
let cache = createTtlCache({
    ttlMs: COURT_AUTOCOMPLETE_CACHE_TTL_MS,
    maxEntries: COURT_AUTOCOMPLETE_CACHE_MAX_ENTRIES
});
/**
 * Below this length a stemmed fallback query is not fired at all. Guards
 * against a bare numbered-instance suffix like "I" (from "Bratislava II"
 * with its last character stripped down to "I") turning into a 1-character
 * query with unpredictable blast radius against a live public API.
 */
const MIN_STEM_QUERY_LENGTH = 3;
/**
 * Builds the ordered list of fallback queries to try against
 * `sud/autocomplete` when the literal `courtName` matched nothing, cheapest
 * (most literal) first:
 *
 *  1. the remainder verbatim (handles masculine place names whose locative
 *     just appends a syllable, e.g. "Trenčín" -> "Trenčíne", and numbered
 *     court families the registry already lists under the old name, e.g.
 *     "Bratislava II" -- these are already substrings of the live name);
 *  2. if the remainder's last token is the abbreviation "SR", that token
 *     expanded to the full official wording "Slovenskej republiky" (this
 *     server's own output uses the shorthand courtType "Najvyšší súd SR",
 *     see `providers/nsud/mapper.ts`, so a caller can plausibly paste it
 *     into `courtName` -- the bare "SR" is both too short to safely stem
 *     (see `MIN_STEM_QUERY_LENGTH`) and not a substring of the registry's
 *     locative-free "Slovenskej republiky", so without this it was a dead
 *     end with zero suggestions);
 *  3. the remainder with its last character stripped (handles feminine
 *     "-a" place names whose locative replaces the final vowel, e.g.
 *     "Žilina" -> "Žiline", and drops a numbered-instance suffix like
 *     "Košice I" -> "Košice");
 *  4. just the last whitespace-separated token, last character stripped
 *     (handles multi-word names where an earlier word also declines, e.g.
 *     the adjective in "Banská Bystrica" -> "Banskej Bystrici", where the
 *     whole-remainder stem "Banská Bystric" is no longer a substring of the
 *     live locative name but the bare noun stem "Bystric" still is).
 *
 * Every tier (including the verbatim one) is gated by
 * `MIN_STEM_QUERY_LENGTH`, not just the stemmed ones -- a short verbatim
 * remainder (e.g. "SR" itself, or whatever survives after the "SR"
 * expansion tier above declines to fire) has no realistic chance of a
 * useful match and firing it anyway is just pointless load against a live
 * public endpoint.
 *
 * This is deliberately not a Slovak declension engine -- it is a substring-
 * search-shaped heuristic tuned against the live `sud/autocomplete`
 * endpoint (see the resolver test fixtures for the live-verified query/
 * response pairs it is built from), not grammar rules.
 */
function buildStemmedFallbackQueries(remainder) {
    const trimmed = remainder.trim();
    if (trimmed.length === 0) {
        return [];
    }
    const queries = [];
    const pushQuery = (query) => {
        if (query.length >= MIN_STEM_QUERY_LENGTH && !queries.includes(query)) {
            queries.push(query);
        }
    };
    pushQuery(trimmed);
    const tokens = trimmed.split(/\s+/);
    const lastToken = tokens[tokens.length - 1] ?? "";
    if (lastToken.toLocaleLowerCase("sk") === "sr") {
        pushQuery([...tokens.slice(0, -1), "Slovenskej republiky"].join(" ").trim());
    }
    pushQuery(trimmed.slice(0, -1).trim());
    pushQuery(lastToken.slice(0, -1));
    return queries;
}
async function queryAutocomplete(client, query) {
    const cacheKey = normalizeCourtNameForMatch(query);
    const candidates = await cache.getOrLoad(cacheKey, () => client.autocompleteCourts({
        provider: "justice",
        query,
        limit: COURT_AUTOCOMPLETE_LIMIT,
        offset: 0
    }));
    if (candidates.length === 0) {
        // Do not let an empty-but-successful load occupy the cache slot -- see
        // the module doc comment above for why.
        cache.delete(cacheKey);
    }
    return candidates;
}
/**
 * Courts get renamed (e.g. the 2023 reorg turned "Okresný súd Bratislava
 * II" into "Mestský súd Bratislava II") and Slovak place names decline
 * irregularly (e.g. the registry lists "Krajský súd v Žiline", locative,
 * while a caller naturally writes "Krajský súd Žilina", nominative) -- and
 * this server's own past output can itself carry either kind of mismatch,
 * so a caller who copies a courtName straight out of an earlier response
 * can hit a wall on a name that resolves to nothing literal. When the
 * literal query matches nothing at all, retry with the court-type prefix
 * stripped and a couple of stemmed variants (see
 * `buildStemmedFallbackQueries`) purely to gather candidate names for the
 * error message -- this never resolves anything on its own, it only makes
 * the resulting not_found error actionable instead of a dead end.
 *
 * Only candidates of a *compatible* court-instance level are ever
 * suggested (same type, or the one genuine Okresný <-> Mestský 2023-reorg
 * exception -- see `courtTypesAreCompatible`). Suggesting across unrelated
 * levels (e.g. offering a district court for a regional-court query, or a
 * differently-typed court under the same city name such as "Správny súd v
 * Bratislave" for a "Krajský súd Bratislava" query) is exactly the wrong
 * lead this function exists to avoid -- see `CourtNameNotFoundError` for
 * why the resulting message also does not call a same-type suggestion a
 * "rename".
 *
 * Ústavný súd (the Constitutional Court) is a separate constitutional body
 * that is never in this ministry-run general-court registry at all -- for
 * it, this returns `[]` immediately without querying, since the only thing
 * a broadened query could surface is a different, incompatible instance
 * level (live-verified: the remainder "Slovenskej republiky" alone returns
 * "Najvyšší súd Slovenskej republiky" / "Najvyšší správny súd Slovenskej
 * republiky"). `CourtNameNotFoundError` handles this case by pointing the
 * caller at `provider="ustavny"` instead of suggesting a wrong court.
 */
async function suggestCourtCandidates(client, courtName) {
    const classified = classifyCourtType(courtName);
    if (!classified) {
        return [];
    }
    if (classified.type === "Ústavný súd") {
        return [];
    }
    for (const query of buildStemmedFallbackQueries(classified.remainder)) {
        const candidates = await queryAutocomplete(client, query);
        const compatible = candidates.filter((item) => {
            const itemType = classifyCourtType(item.nazov);
            return itemType !== null && courtTypesAreCompatible(itemType.type, classified.type);
        });
        if (compatible.length > 0) {
            return compatible.map((item) => item.nazov);
        }
    }
    return [];
}
/**
 * Resolves a free-form `courtName` to a court GUID (`registreGuid`, the
 * value the justice API calls `guidSud`) via the existing
 * `sud/autocomplete` lookup -- the same one `search_courts` uses -- instead
 * of adding a second HTTP client.
 *
 * Matching rule: query autocomplete with `courtName` as the search text,
 * then prefer an exact (case/diacritics-insensitive) name match even when
 * the endpoint also returned other partial matches (e.g. "Najvyšší súd
 * Slovenskej republiky" must resolve on its own even though the same query
 * also surfaces "Najvyšší správny súd Slovenskej republiky"). Any candidate
 * set with no exact match is rejected outright, never guessed at, even when
 * it contains exactly one partial candidate: live-verified, "Okresný súd
 * Bratislava" returns exactly one match ("Okresný súd Bratislava V", since
 * Bratislava I-IV became Mestské súdy in the 2023 reorg) -- silently
 * resolving to it would narrow the caller's request to a specific court
 * they never named, which is exactly the guess this feature exists to
 * refuse. Zero candidates falls back to a renamed-court suggestion lookup
 * (see `suggestCourtCandidates`) so the resulting error is
 * actionable rather than a dead end.
 */
export async function resolveJusticeCourtGuid(client, courtName) {
    const candidates = await queryAutocomplete(client, courtName);
    if (candidates.length === 0) {
        return { status: "not_found", suggestions: await suggestCourtCandidates(client, courtName) };
    }
    const exact = candidates.filter((candidate) => courtNamesMatch(candidate.nazov, courtName));
    if (exact.length === 1) {
        const match = exact[0];
        return { status: "resolved", guid: match.registreGuid, matchedName: match.nazov };
    }
    // No unambiguous exact match -- reject rather than guess, whether that
    // means one partial candidate, several, or several exact matches (an
    // edge case if the registry ever returns duplicate names).
    const named = exact.length > 1 ? exact : candidates;
    return { status: "ambiguous", candidates: named.map((item) => item.nazov) };
}
/** Test-only: wipe the in-process court-autocomplete cache so unit tests are isolated. */
export function __clearJusticeCourtResolverCacheForTests() {
    cache = createTtlCache({
        ttlMs: COURT_AUTOCOMPLETE_CACHE_TTL_MS,
        maxEntries: COURT_AUTOCOMPLETE_CACHE_MAX_ENTRIES
    });
}
//# sourceMappingURL=court-resolver.js.map