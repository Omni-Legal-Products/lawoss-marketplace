import { courtNamesMatch } from "../../domain/court-name-match.js";
import { buildAvailabilityNotes, buildSourceAvailability } from "../../domain/source-availability.js";
import { buildSourceProvenance } from "../../domain/source-provenance.js";
import { NSUD_COURT_NAME, NSUD_COURT_TYPE, buildNsudDecisionPageUrl, extractSpisIdFromEcli } from "../../providers/nsud/mapper.js";
import { getNsudRecordsDateFreshness, loadNsudLawIndexState, searchNsudRecordsByDateRange } from "../../providers/nsud/law-index-store.js";
import { appendCoverageNotes } from "./normalize.js";
import { runSingleProviderSearchDecisions } from "./single.js";
/**
 * Whether a given `SearchDecisionsInput` field is compatible with serving a
 * pure date-range nsud query from the local index. `true` = the local route
 * is unaffected by it (it IS the date range itself, or purely mechanical --
 * pagination/presentation); `false` = disqualifying, because a local
 * `records` row (`id`/`ecli`/`spisovaZnacka`/`dateIssued` only) has no way
 * to honor it, and silently ignoring a requested filter would violate "if a
 * provider does not support a filter, do not pretend it was applied"
 * (docs/TOOLS_SPEC.md section 6).
 *
 * This is an ALLOWLIST typed as `Record<keyof SearchDecisionsInput,
 * boolean>` -- not a denylist array -- specifically so the TS compiler
 * forces a decision here the moment `SearchDecisionsInputSchema` gains a new
 * field: under `strict`, a `Record` missing a required property is a
 * compile error, so a newly added filter can never silently fall through as
 * "compatible with local routing" the way an array-based denylist would if
 * someone forgot to add it.
 */
const NSUD_LOCAL_ROUTE_FIELD_COMPATIBILITY = {
    provider: true,
    dateFrom: true,
    dateTo: true,
    limit: true,
    offset: true,
    view: true,
    query: false,
    courtId: false,
    courtType: false,
    courtName: false,
    ecli: false,
    spisovaZnacka: false,
    identifikacneCisloSpisu: false,
    legalArea: false,
    legalSubArea: false,
    decisionForm: false,
    decisionNature: false,
    citedLaw: false
};
/**
 * True when `input` carries a date range and nothing else the local index
 * cannot honor -- regardless of what `input.provider` itself is set to.
 * Provider-agnostic on purpose: `provider="auto"` also needs to ask "would
 * the nsud leg of this query be servable locally?" without first rewriting
 * `provider` to `"nsud"`.
 */
export function hasOnlyDateRangeCriteria(input) {
    if (!input.dateFrom && !input.dateTo)
        return false;
    return Object.keys(NSUD_LOCAL_ROUTE_FIELD_COMPATIBILITY).every((field) => NSUD_LOCAL_ROUTE_FIELD_COMPATIBILITY[field] || input[field] === undefined);
}
/** True when this is a pure nsud date-range lookup: servable from the local index. */
export function isNsudDateOnlyLocalQuery(input) {
    return input.provider === "nsud" && hasOnlyDateRangeCriteria(input);
}
export const NSUD_DATE_TEXT_COMBO_NOTE = "nsud: the NS SR portal does not honor date filters (art_datum_od/art_datum_do) once a text-like " +
    "criterion is also present, so this response used the live provider path with local date-range " +
    "verification -- rows outside the range were dropped, not silently kept. To get an honest date-range " +
    "count and page, drop the text criterion and call search_decisions again with only " +
    "provider=\"nsud\" and dateFrom/dateTo (served from the local index). For a wording search, use " +
    "search_decision_text instead.";
/**
 * True when `courtName` is present and names a court other than the one
 * nsud covers -- i.e. `NsudProvider#searchDecisions` will short-circuit to
 * an empty result + its own mismatch note WITHOUT ever calling the live
 * client. Exported so both `dispatchSingleProviderSearchDecisions` below
 * and `auto.ts` can avoid claiming the live path ran (`NSUD_DATE_TEXT_COMBO_NOTE`)
 * or that no provider searched at all when that never happened.
 */
export function isNsudCourtNameMismatch(courtName) {
    return Boolean(courtName) && !courtNamesMatch(courtName, NSUD_COURT_NAME);
}
/**
 * Routes a single-provider `search_decisions` call: nsud date-only queries
 * go to the local index (honest total, honest page); nsud date+text
 * combinations keep the live path but gain an actionable note; everything
 * else is unchanged.
 */
export async function dispatchSingleProviderSearchDecisions(input, providerId, provider) {
    if (providerId !== "nsud" || (!input.dateFrom && !input.dateTo)) {
        return runSingleProviderSearchDecisions(input, providerId, provider);
    }
    if (hasOnlyDateRangeCriteria(input)) {
        return runNsudDateOnlyLocalSearch(input);
    }
    const live = await runSingleProviderSearchDecisions(input, providerId, provider);
    // A courtName mismatch makes NsudProvider#searchDecisions short-circuit
    // before ever calling the live client -- the combo note's claim ("used
    // the live provider path with local date-range verification") would be
    // false in that case, so it is only appended when the live path actually
    // ran.
    return isNsudCourtNameMismatch(input.courtName)
        ? live
        : appendCoverageNotes(live, [NSUD_DATE_TEXT_COMBO_NOTE]);
}
export async function runNsudDateOnlyLocalSearch(input) {
    const dateFrom = input.dateFrom ?? null;
    const dateTo = input.dateTo ?? null;
    // An impossible range (dateFrom after dateTo) would otherwise silently
    // answer total:0 -- indistinguishable from "the range is valid but empty".
    // Anchored ISO strings compare correctly lexicographically, same as the
    // range predicate itself.
    if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
        return {
            total: 0,
            items: [],
            providerBreakdown: { nsud: 0 },
            dedupApplied: false,
            coverageNotes: [
                `nsud: the requested date range is empty -- dateFrom (${dateFrom}) is after dateTo (${dateTo}), ` +
                    "so no row can ever match it. This total:0 does not mean 'no decisions found'; swap the bounds " +
                    "or provide only one of them."
            ]
        };
    }
    // `Promise.all` here does NOT parallelize this work: `DatabaseSync`'s
    // `.prepare(...).all()`/`.get()` calls are synchronous and block the JS
    // thread, and none of these three functions has an `await` between
    // opening the (cached, already-open) handle and issuing its query, so
    // each one runs to completion before the next starts regardless of this
    // `Promise.all` wrapping -- the wall-clock cost is their sum, not their
    // max. Measured on a synthetic 161k-row table: ~1.5ms (page query) +
    // ~31.5ms (freshness) + a negligible state read, so ~33ms total main-
    // thread block for this call (well under the 10s healthcheck timeout /
    // 45s watchdog this server has, so accepted rather than optimized further
    // here -- see the fix report for the freshness-query split that already
    // roughly halved this).
    const [{ rows, total }, freshness, state] = await Promise.all([
        searchNsudRecordsByDateRange({
            dateFrom,
            dateTo,
            limit: input.limit,
            offset: input.offset
        }),
        getNsudRecordsDateFreshness(),
        loadNsudLawIndexState()
    ]);
    const items = rows.map(mapLocalNsudRecordToSummary);
    const coverageNotes = [
        "nsud: this response was served from the local NS SR index (records table) rather than a live " +
            "portal search -- the NS SR searchDecision endpoint ignores date filters and always returns the " +
            "same first page, so date-range queries are answered locally instead, where total is a real " +
            "COUNT(*) over the range. In view=standard/full, up to 3 metadata-only items may still be " +
            "enriched with one live per-id lookup each for richer detail (see hydrate.ts); any dateIssued " +
            "returned by that lookup is re-verified against the requested range before being returned, so it " +
            "cannot silently reintroduce an out-of-range result.",
        "nsud: total counts every matching row including the NS portal's own duplicate copies of some " +
            "judgments (dedup only applies across the items actually returned together in one response, the " +
            "same total-before-dedup semantics the existing multi-provider merge already uses) -- a duplicate " +
            "pair can straddle two different pages, so the same decision can appear once on each of two " +
            "adjacent pages without duplicatesSuppressed being set on either.",
        buildFreshnessNote(freshness, state.lastRunAt, state.nextDecisionId ?? null)
    ];
    if (freshness.invalidDateIssuedCount > 0) {
        coverageNotes.push(`nsud: ${freshness.invalidDateIssuedCount} record(s) in the local index store an unparsable ` +
            "date_issued (empty string or non-ISO format) and are excluded from every date-range query, " +
            "including this one, the same way the live path drops rows with a missing/unparsable dateIssued.");
    }
    return {
        total,
        items,
        providerBreakdown: { nsud: items.length },
        dedupApplied: false,
        coverageNotes
    };
}
function mapLocalNsudRecordToSummary(row) {
    // A local records row is metadata only (id/ecli/spisovaZnacka/dateIssued) --
    // no obsah/subor, so document/text availability is genuinely unknown here,
    // never fabricated as available.
    const sourceCompleteness = "metadata";
    const sourceAvailability = buildSourceAvailability(sourceCompleteness, "none");
    return {
        provider: "nsud",
        providerId: row.id,
        ecli: row.ecli,
        courtName: NSUD_COURT_NAME,
        courtId: null,
        courtType: NSUD_COURT_TYPE,
        spisovaZnacka: row.spisovaZnacka,
        identifikacneCisloSpisu: extractSpisIdFromEcli(row.ecli ?? undefined),
        decisionForm: null,
        decisionNature: [],
        dateIssued: row.dateIssued,
        judgeName: null,
        legalAreas: [],
        legalSubAreas: [],
        title: row.spisovaZnacka,
        summary: null,
        documentUrl: null,
        // buildNsudDecisionPageUrl itself nulls this out when spisovaZnacka is
        // not a real case reference (see mapper.ts) -- not re-validated here.
        sourceUrl: buildNsudDecisionPageUrl(row.spisovaZnacka ?? undefined),
        updatedAt: null,
        retrievedAt: new Date().toISOString(),
        sourceAvailability,
        sourceProvenance: buildSourceProvenance({
            provider: "nsud",
            availability: sourceAvailability,
            dateIssued: row.dateIssued
        }),
        sourceCompleteness,
        availabilityNotes: buildAvailabilityNotes({ ...sourceAvailability, provider: "nsud" }),
        normalizationConfidence: "medium"
    };
}
/**
 * States plainly how fresh the local index's DATE coverage is: the newest
 * decision date actually present in `records`, read straight from the data.
 *
 * Deliberately NOT derived from the indexer's id cursor
 * (`highestKnownDecisionId`/`nextDecisionId`/mode) the way an earlier
 * version of this note was. Two reasons that version was wrong:
 *
 *  1. The indexer's own head-detection has been wrong before while still
 *     reporting a plausible cursor (the 2026-08-10 incident, see
 *     docs/NSUD_INDEXING.md) -- so "caught up to the detected corpus head"
 *     can be a confident, false claim exactly when the head itself is
 *     stale. Production commonly sits in "recent-only" mode
 *     (`nextDecisionId === null`) with a stale head, which is precisely the
 *     state that made the old wording say "caught up" when it should not
 *     have.
 *  2. The backfill descends from the head towards id 1
 *     (`indexer.ts#processDescendingBatch`, `nextDecisionId -= 1`), so
 *     `highestKnownDecisionId - nextDecisionId` measures how far the
 *     backfill has already walked down from the head -- i.e. how much of
 *     the *older* corpus is done -- not a shortfall at the recent end. The
 *     old wording ("still N id(s) behind the head, recent decisions may be
 *     missing") had that backwards: recent ids are covered by a separate
 *     "recent catch-up" step every run, while the actually-unindexed region
 *     during a mid-backfill is the OLDEST ids, not the newest.
 *
 * Reading `MAX(date_issued)` sidesteps both problems: it needs no knowledge
 * of backfill direction, mode, or a possibly-stale head, and it self-heals
 * automatically as new decisions are indexed.
 *
 * `nextDecisionId` is the one piece of id-cursor state still surfaced here,
 * and only as a plain fact, not as a "caught up" verdict: when it is not
 * null the backfill is still descending towards id 1 (older decisions),
 * so coverage is ALSO missing at the OLD end, below whatever date
 * corresponds to that frontier -- the mirror image of the freshness gap at
 * the new end. Without this, `total` (advertised elsewhere as "a real
 * COUNT(*)") would look definitive for an old date range even while the
 * backfill has not reached it yet, and a reader would wrongly read
 * total:0 there as "no such decisions exist" instead of "not ingested
 * yet". Not reachable in production today (steady state is `nextDecisionId:
 * null`), but exactly the state a partially-restored snapshot arrives in.
 */
function buildFreshnessNote(freshness, lastRunAt, nextDecisionId) {
    const coverage = freshness.maxDateIssued !== null
        ? `covers NS SR decisions with a recorded date_issued up to ${freshness.maxDateIssued}`
        : "has no valid date_issued values at all yet (empty index, or every stored value is unparsable)";
    const oldEndCaveat = nextDecisionId !== null
        ? ` Also: backfill still in progress at id ${nextDecisionId} -- decisions older than that frontier ` +
            "may be missing from this count too, the same way decisions past the max date above are."
        : "";
    return (`nsud local-index freshness: last indexer run ${lastRunAt ?? "(never)"}; the local index currently ` +
        `${coverage}. A requested range extending past that date will under-report decisions issued after ` +
        "it -- call get_nsud_index_stats for current indexer state before treating a low/zero count near " +
        `that date as final.${oldEndCaveat} ${JUSTICE_PROVIDER_ALTERNATIVE_NOTE}`);
}
/**
 * Deliberately a fixed, standalone fact -- NOT derived from `freshness` or
 * `nextDecisionId` above, and deliberately making NO claim about the
 * upstream NS SR Open Data feed's own extent.
 *
 * INCIDENT: an earlier version of this sentence asserted "the NS SR Open
 * Data feed itself currently ends around early 2023". That claim was never
 * true and was never derivable from any state this server holds -- it was
 * extrapolated from a gap in this local mirror's own id space, which is a
 * property of OUR indexing progress, not of the upstream feed. Verified
 * live (2026-08-11, curl against the feed directly): `?getDecision&id=246716`
 * -> `1Ndob/6/2026`, dated 2026-07-01; the feed is current. A lawyer
 * searching for 2025 case law was getting `total: 0` plus a confident,
 * false statement that the source itself had nothing newer.
 *
 * There is no live signal available here for the feed's true extent (this
 * server only mirrors it, and only partially) -- so, per "any hardcoded
 * cutoff will rot exactly the same way", nothing replaces that sentence.
 * The only thing this note still asserts is provider="justice" as an
 * alternative route to recent Supreme Court decisions, which does not
 * depend on how far this local mirror has caught up and needs no
 * date claim to be true.
 */
const JUSTICE_PROVIDER_ALTERNATIVE_NOTE = 'provider="justice" with a court filter also carries recent Supreme Court decisions, regardless of this ' +
    "local nsud mirror's own indexing progress.";
//# sourceMappingURL=nsud-local-date.js.map