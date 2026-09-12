import { applyDateRangeGuard } from "../../domain/merge.js";
/**
 * Runs a single-provider search and applies the same post-fetch date-range
 * guard the auto (multi-provider) path applies before merging. A direct
 * provider=nsud/justice/ustavny query gets the same correctness guarantee
 * as auto mode: a provider that ignores (or only partially honors)
 * dateFrom/dateTo never gets to silently return out-of-range rows.
 */
export async function runSingleProviderSearchDecisions(input, providerId, provider) {
    const result = await provider.searchDecisions(input);
    return applyDateRangeGuard(result, input, providerId);
}
//# sourceMappingURL=single.js.map