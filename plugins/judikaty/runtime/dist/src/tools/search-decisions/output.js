import { buildSearchFallbackBoundary } from "../../domain/fallback-boundary.js";
import { hasUnhonouredFilterFields } from "../../domain/search-filter-capabilities.js";
import { detectNsudSearchParamCollisions } from "../../providers/nsud/provider.js";
import { presentSearchResult } from "../../server/presenters.js";
import { hydrateSearchResultItems } from "./hydrate.js";
import { reconcilePostHydrationDates } from "./hydration-date-guard.js";
import { rerankSearchResultsForReadability } from "./rerank.js";
import { buildSearchEnrichment } from "./enrichment.js";
import { annotateItemsWithTreatment } from "./treatment-flags.js";
import { resolveDecisionIdentities } from "../../domain/decision-identity.js";
import { getDecisionTextHeaders } from "../../providers/nsud/law-index-store.js";
/**
 * Clean up decision identity, then flag validity.
 *
 * Order matters: a reference recovered from the text header is what makes the
 * treatment lookup possible for the 41.6% of NS records the portal never gave one,
 * so identity must be resolved before flags are attached.
 */
async function resolveIdentitiesAndTreatment(baseItems) {
    if (!Array.isArray(baseItems))
        return { items: baseItems, duplicatesSuppressed: 0 };
    const { items: resolved, duplicatesSuppressed } = await resolveDecisionIdentities(baseItems, getDecisionTextHeaders);
    const items = await annotateItemsWithTreatment(resolved);
    return { items, duplicatesSuppressed };
}
export function annotateSearchOutput(result, input) {
    const presented = presentSearchResult(result, input.view);
    // Compact view normally drops coverageNotes to save tokens, but three
    // situations need their notes to reach the caller even in compact view,
    // or the cardinal "never silently drop a requested filter" rule would be
    // broken by the token-saving trim itself:
    //  1. a date-filtered query, where the date-range-guard's verification
    //     notes (domain/merge.ts#applyDateRangeGuard) explain a
    //     dropped/adjusted result;
    //  2. a query naming courtName, or containing any field the resolved
    //     provider(s) do not honour (domain/search-filter-capabilities.ts) --
    //     both cases can otherwise mean "0 results, no explanation" for a
    //     filter that silently wasn't applied (or matched a court other than
    //     the one requested), the exact failure mode this guard exists to
    //     rule out;
    //  3. an nsud field-COMBINATION collision (nsud/provider.ts#
    //     detectNsudSearchParamCollisions, e.g. query+citedLaw both target
    //     the same upstream param) -- individually each field is honoured
    //     (case 2's declaration table is correctly `true` for both), so only
    //     this dedicated check catches it.
    const nsudLegPossiblyQueried = input.provider === "nsud" || input.provider === "auto";
    const mustKeepCoverageNotes = input.view === "compact" &&
        result.coverageNotes.length > 0 &&
        (Boolean(input.dateFrom || input.dateTo || input.courtName) ||
            hasUnhonouredFilterFields(input) ||
            (nsudLegPossiblyQueried && detectNsudSearchParamCollisions(input).length > 0));
    const withDateGuardNotes = mustKeepCoverageNotes
        ? { ...presented, coverageNotes: result.coverageNotes }
        : presented;
    const fallbackBoundary = buildSearchFallbackBoundary(input, result.total);
    if (!fallbackBoundary) {
        return withDateGuardNotes;
    }
    return {
        ...withDateGuardNotes,
        fallbackBoundary
    };
}
export async function buildSearchToolOutput(result, input, registry) {
    if (input.view === "compact") {
        // Genuinely cheap path: no hydration, no enrichment, no web fallback —
        // just the pure/local rerank plus local-SQLite treatment flags.
        const ranked = rerankSearchResultsForReadability(result);
        const base = annotateSearchOutput(ranked, input);
        const { items, duplicatesSuppressed } = await resolveIdentitiesAndTreatment(base.items);
        return {
            ...base,
            ...(duplicatesSuppressed > 0 ? { duplicatesSuppressed } : {}),
            items
        };
    }
    const hydrated = await hydrateSearchResultItems(result, registry);
    // Hydration can replace a metadata_only item (every local-nsud-index item
    // qualifies) with a freshly fetched live detail (see hydrate.ts) --
    // including a possibly different dateIssued. When the caller requested a
    // date range, that hydrated date has never been checked against it: the
    // pre-fetch guards (single.ts/auto.ts#applyDateRangeGuard) run BEFORE
    // hydration exists, and the local-index route's own SQL predicate only
    // covers what it originally returned, not what hydration substituted in.
    // `reconcilePostHydrationDates` (NOT applyDateRangeGuard -- see its own
    // doc comment for why that was tried and reverted) falls a drifted item
    // back to its pre-hydration, already-verified version instead of
    // dropping it, leaving items/total/providerBreakdown untouched; a no-op
    // when no date range was requested or nothing actually drifted.
    const dateGuarded = reconcilePostHydrationDates(result, hydrated, input);
    const ranked = rerankSearchResultsForReadability(dateGuarded);
    const base = annotateSearchOutput(ranked, input);
    const enrichment = await buildSearchEnrichment(ranked, registry, input);
    // Presented items are a loose Record shape; annotate them with local
    // treatment flags (⚠️ zrušené, ...) when spisovaZnacka is known.
    const { items, duplicatesSuppressed } = await resolveIdentitiesAndTreatment(base.items);
    return {
        ...base,
        ...(duplicatesSuppressed > 0 ? { duplicatesSuppressed } : {}),
        items,
        ...enrichment
    };
}
//# sourceMappingURL=output.js.map