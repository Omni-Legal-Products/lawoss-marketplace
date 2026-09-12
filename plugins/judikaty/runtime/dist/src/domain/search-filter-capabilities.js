/**
 * Per-provider declaration of which `SearchDecisionsInput` fields that
 * provider's `searchDecisions()` actually honours -- narrows its results by,
 * end to end -- as opposed to silently dropping a field, or applying it to
 * something that does not correspond to its meaning. This is the structural
 * guard against the bug class this project has now hit four times in one
 * day: dates on nsud, courtName on justice, the nsud
 * query/citedLaw/decisionForm upstream-param collisions, and nsud's
 * `decisionForm` a second time, standalone -- a filter present in the
 * request that the chosen provider has no real way to apply.
 *
 * THE CRITERION IS SEMANTIC, NOT MECHANICAL. `true` means: a caller who
 * requests this field can trust the returned results were actually
 * filtered by it, by WHATEVER means end up making that true (a genuine
 * upstream param that the upstream service acts on, in-process
 * verification, a post-fetch guard, or routing to a local index) -- not
 * merely "the client transmits it to some outbound parameter somewhere". A
 * field the client sends upstream but that the upstream service ignores,
 * silently misinterprets, or applies to a different concept than the field
 * name promises must be declared `false` here even though it genuinely IS
 * "sent upstream" in the narrow, mechanical sense. That narrower,
 * mechanical reading is exactly what produced two false rows this project
 * has actually shipped -- both on nsud, kept here to calibrate the next
 * field added:
 *
 *  - nsud's `dateFrom`/`dateTo` ARE correctly `true` -- not merely because
 *    the raw `art_datum_od`/`art_datum_do` params are sent (they are, and
 *    the NS SR portal ignores both once any other criterion is also
 *    present, ALWAYS returning the same first ~2011-decisions page
 *    instead), but because two compensating mechanisms in this codebase
 *    make the end-to-end result genuinely date-filtered regardless: a pure
 *    date-range nsud query is served from the local index instead of the
 *    live portal (`tools/search-decisions/nsud-local-date.ts`), and every
 *    other nsud path re-verifies dates post-fetch
 *    (`domain/merge.ts#applyDateRangeGuard`). Remove either mechanism and
 *    this row must flip to `false` -- `true` here is earned by those two
 *    mechanisms, not by the upstream send.
 *  - nsud's `decisionForm` is `false`. It is not sent to any upstream
 *    parameter at all -- `nsud/client.ts#searchDecisionIds` simply never
 *    writes it, because the NS SR portal has no decision-type/category
 *    filter to send it to. It was previously (mis)mapped to `art_merito`,
 *    which looks like a plausible upstream slot but is actually a free-text
 *    search over the short merit-summary phrase (`getDecision`'s `merito`
 *    field, e.g. "určenie neplatnosti nájomnej zmluvy"), not a category
 *    filter -- live-verified (2026-08-11): real decision-form words like
 *    "Rozsudok"/"Uznesenie" each matched only a small, arbitrary slice of a
 *    ~161k-decision corpus consisting almost entirely of those two forms
 *    (impossible counts for an actual category filter), and sending it
 *    there could silently DELETE genuine results instead of merely
 *    no-op'ing (a real spisovaZnacka match went from 1 result to 0 once
 *    art_merito was added). That mapping has been removed; do not
 *    resurrect it under the `decisionForm` name -- see the removal note at
 *    the `art_merito` call site in client.ts. Nothing in this codebase
 *    compensates the way the two date mechanisms above compensate, so
 *    `decisionForm` is genuinely unhonoured on nsud end to end and must be
 *    declared so. `NsudProvider#searchDecisions` (nsud/provider.ts)
 *    additionally emits a dedicated, specific coverageNotes entry
 *    explaining WHY and pointing to `provider="justice"` (which has a
 *    genuine decision-form filter, `formaRozhodnutiaFacetFilter`) -- the
 *    generic `buildUnhonouredFilterCoverageNote` this file's `false`
 *    triggers below is correct but generic ("not honoured"), not specific
 *    about the reason.
 *
 * When adding a field: do not stop at "does the client transmit this
 * param somewhere" -- that mechanical question is exactly what produced
 * both rows above. Confirm with a LIVE call that the upstream service's
 * results actually narrow by it the way the field name promises (or that
 * this codebase has its own compensating verification/routing when the
 * upstream service does not), and declare `true` only then.
 *
 * This is a DIFFERENT question from
 * `tools/search-decisions/nsud-local-date.ts`'s
 * `NSUD_LOCAL_ROUTE_FIELD_COMPATIBILITY`, which asks "can THIS ONE nsud
 * date-range query be served from the local index instead of the live nsud
 * portal" -- a routing decision, not a capability declaration. Do not merge
 * the two maps; a field can be `true` here (nsud's `dateFrom` genuinely
 * ends up honoured, end to end) while still being routed locally for
 * unrelated reasons.
 *
 * `Record<keyof SearchDecisionsInput, boolean>` (not a denylist array) so
 * TS's exhaustiveness check under `strict` forces a decision here the
 * moment `SearchDecisionsInputSchema` gains a field -- a newly added filter
 * can never silently fall through as "honoured" the way an array-based
 * denylist would if someone forgot to add it. `provider`/`limit`/`offset`/
 * `view` are mechanical (pagination/routing, not filters) and are always
 * `true`.
 */
export const SEARCH_DECISIONS_FILTER_CAPABILITIES = {
    // justice/client.ts#searchDecisions sends every field below as an upstream
    // query param. courtName is honoured post-fix by resolving it to guidSud
    // (JusticeProvider#searchDecisions) rather than being forwarded verbatim.
    justice: {
        query: true,
        provider: true,
        courtId: true,
        courtType: true,
        courtName: true,
        ecli: true,
        spisovaZnacka: true,
        identifikacneCisloSpisu: true,
        dateFrom: true,
        dateTo: true,
        legalArea: true,
        legalSubArea: true,
        decisionForm: true,
        decisionNature: true,
        citedLaw: true,
        limit: true,
        offset: true,
        view: true
    },
    // nsud/client.ts#searchDecisionIds only ever sends nazov/art_obsah/
    // art_ecli/art_datum_od/art_datum_do -- courtId/courtType/
    // identifikacneCisloSpisu/legalArea/legalSubArea/decisionNature/
    // decisionForm have no upstream parameter at all (decisionForm
    // deliberately so, as of this fix -- see the header comment above for why
    // its former art_merito mapping was removed rather than kept and simply
    // declared false). courtName is honoured separately: nsud is a single
    // court, so NsudProvider#searchDecisions verifies the requested name
    // matches it (empty result + note on mismatch) instead of ignoring it.
    nsud: {
        query: true,
        provider: true,
        courtId: false,
        courtType: false,
        courtName: true,
        ecli: true,
        spisovaZnacka: true,
        identifikacneCisloSpisu: false,
        dateFrom: true,
        dateTo: true,
        legalArea: false,
        legalSubArea: false,
        decisionForm: false,
        decisionNature: false,
        citedLaw: true,
        limit: true,
        offset: true,
        view: true
    },
    // ustavny/client.ts#buildSearchPayload maps query, spisovaZnacka, ecli,
    // identifikacneCisloSpisu, decisionForm, decisionNature, legalArea,
    // legalSubArea, citedLaw, and the date range -- courtId/courtType have no
    // filter field (ustavny is a single court). courtName is honoured the
    // same way as nsud: an exact match against the one court it covers.
    ustavny: {
        query: true,
        provider: true,
        courtId: false,
        courtType: false,
        courtName: true,
        ecli: true,
        spisovaZnacka: true,
        identifikacneCisloSpisu: true,
        dateFrom: true,
        dateTo: true,
        legalArea: true,
        legalSubArea: true,
        decisionForm: true,
        decisionNature: true,
        citedLaw: true,
        limit: true,
        offset: true,
        view: true
    }
};
/**
 * Every field present in `input` (not `undefined`) that `providerId`'s
 * declared capabilities mark as unhonoured. Empty means every requested
 * filter is either absent or genuinely applied.
 */
export function findUnhonouredFilterFields(input, providerId) {
    const capability = SEARCH_DECISIONS_FILTER_CAPABILITIES[providerId];
    return Object.keys(capability).filter((field) => {
        if (input[field] === undefined)
            return false;
        return !capability[field];
    });
}
/**
 * Single-argument convenience over `findUnhonouredFilterFields`: resolves
 * which provider(s) `input.provider` implies (both legs of `"auto"`) and
 * reports whether ANY of them would drop a requested filter. Used where the
 * caller only has the input, not a specific provider leg -- e.g. deciding
 * whether a compact-view response must keep its `coverageNotes` visible.
 */
export function hasUnhonouredFilterFields(input) {
    return resolveCapabilityProviderIds(input.provider).some((providerId) => findUnhonouredFilterFields(input, providerId).length > 0);
}
/**
 * "not honoured" / "NOT applied" wording deliberately echoes
 * docs/TOOLS_SPEC.md section 6 ("If a provider does not support a filter,
 * do not pretend it was applied") verbatim enough to be recognizable as the
 * same rule.
 */
export function buildUnhonouredFilterCoverageNote(providerId, fields) {
    return (`${providerId}: the following requested filter field(s) are not honoured by this provider and were ` +
        `NOT applied to its results: ${fields.join(", ")}.`);
}
/** Which providers' declarations apply to a given `SearchDecisionsInput.provider` value. */
export function resolveCapabilityProviderIds(provider) {
    return provider === "auto" ? ["justice", "nsud"] : [provider];
}
//# sourceMappingURL=search-filter-capabilities.js.map