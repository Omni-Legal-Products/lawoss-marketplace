import { applyDateRangeGuard, mergeSearchDecisionResults } from "../../domain/merge.js";
import { AmbiguousCourtNameError, CourtFilterMismatchError, CourtNameNotFoundError } from "../../domain/errors.js";
import { appendCoverageNotes, formatSearchProviderError } from "./normalize.js";
import { NSUD_DATE_TEXT_COMBO_NOTE, hasOnlyDateRangeCriteria, isNsudCourtNameMismatch, runNsudDateOnlyLocalSearch } from "./nsud-local-date.js";
/**
 * True for exactly the errors `JusticeProvider.searchDecisions` throws when
 * `courtName` could not be resolved to one court (ambiguous, no match, or a
 * `courtId`/`courtName` conflict) -- i.e. the justice leg never actually
 * searched anything, as opposed to failing for an unrelated reason (network
 * error, upstream 5xx, etc).
 */
function isCourtNameResolutionError(error) {
    return (error instanceof AmbiguousCourtNameError ||
        error instanceof CourtNameNotFoundError ||
        error instanceof CourtFilterMismatchError);
}
/**
 * `provider` defaults to `"auto"` (see `SearchDecisionsInputSchema`), so a
 * date-range query that never names `provider="nsud"` explicitly still has
 * to reach the local-index route -- otherwise the default path silently
 * keeps using the live nsud portal (which ignores the date filter and
 * always returns the same first page), while only an explicit
 * `provider="nsud"` call would ever see the fix. The justice leg is always
 * unchanged: it goes through `provider.searchDecisions` + the existing
 * `applyDateRangeGuard`, exactly as before.
 */
export async function runAutoSearchDecisions(input, providers) {
    const nsudLocalEligible = hasOnlyDateRangeCriteria(input);
    const nsudDateTextCombo = !nsudLocalEligible && Boolean(input.dateFrom || input.dateTo);
    // Deterministic from the input alone (mirrors NsudProvider's own
    // single-court check) -- true whenever courtName is present and names a
    // court other than the one nsud covers, regardless of what nsud's actual
    // settle outcome turns out to be.
    const nsudCourtNameMismatch = isNsudCourtNameMismatch(input.courtName);
    const settled = await Promise.allSettled(providers.map(({ id, provider }) => {
        if (id === "nsud" && nsudLocalEligible) {
            return runNsudDateOnlyLocalSearch(input);
        }
        return provider.searchDecisions({ ...input, provider: id });
    }));
    const successfulResults = [];
    const failureNotes = [];
    let justiceCourtNameError = null;
    // True only once the nsud leg has actually FULFILLED with the courtName
    // mismatch shape -- if nsud instead rejected (failed for an unrelated
    // reason), this stays false and the normal all-failed combined-error path
    // below applies, preserving both failure messages.
    let nsudFulfilledAsCourtNameMismatch = false;
    settled.forEach((result, index) => {
        const providerId = providers[index]?.id ?? "unknown";
        if (result.status === "fulfilled") {
            if (providerId === "nsud" && nsudCourtNameMismatch) {
                nsudFulfilledAsCourtNameMismatch = true;
            }
            if (providerId === "nsud" && nsudLocalEligible) {
                // Already verified/filtered locally by the SQL predicate itself --
                // applyDateRangeGuard would be a pure no-op, and running it would
                // wrongly imply this result needs the same "unreliable upstream
                // provider" verification a live-queried result does.
                successfulResults.push(result.value);
                return;
            }
            const guarded = applyDateRangeGuard(result.value, input, providerId);
            successfulResults.push(
            // A courtName mismatch makes NsudProvider short-circuit before
            // ever calling the live client, so the combo note's claim ("used
            // the live provider path") would be false in that case.
            providerId === "nsud" && nsudDateTextCombo && !nsudCourtNameMismatch
                ? appendCoverageNotes(guarded, [NSUD_DATE_TEXT_COMBO_NOTE])
                : guarded);
            return;
        }
        if (providerId === "justice" && isCourtNameResolutionError(result.reason)) {
            justiceCourtNameError = result.reason;
        }
        failureNotes.push(`Auto search could not retrieve ${providerId} results: ${formatSearchProviderError(result.reason)}`);
    });
    // Review finding 5: justice couldn't even attempt the search because
    // courtName didn't resolve (ambiguous/not-found/courtId conflict), AND
    // nsud's own leg never actually searched either (it declared the
    // requested court is not the one it covers) -- so NO provider searched
    // anything. Merging to total:0/items:[] here would read as "no such
    // decisions exist", the most dangerous possible misreading for a
    // practising lawyer. Propagate the real resolution error instead.
    if (justiceCourtNameError && nsudFulfilledAsCourtNameMismatch) {
        throw justiceCourtNameError;
    }
    if (successfulResults.length === 0) {
        throw new Error(failureNotes.length > 0
            ? failureNotes.join(" | ")
            : "Auto search failed before any provider returned a result.");
    }
    return appendCoverageNotes(mergeSearchDecisionResults(successfulResults), failureNotes);
}
//# sourceMappingURL=auto.js.map