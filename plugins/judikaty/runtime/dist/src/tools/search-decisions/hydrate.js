import { buildMergedCoverageNotes } from "../../domain/merge.js";
import { decisionReadabilityScore, stripMergedCoverageNotes } from "./readability.js";
const HYDRATE_MAX_CANDIDATES = 3;
export async function hydrateSearchResultItems(result, registry) {
    const candidates = result.items
        .filter((item) => item.sourceAvailability.status === "metadata_only")
        .slice(0, HYDRATE_MAX_CANDIDATES);
    if (candidates.length === 0) {
        return result;
    }
    const grouped = new Map();
    for (const item of candidates) {
        const bucket = grouped.get(item.provider) ?? [];
        bucket.push({ provider: item.provider, id: item.providerId });
        grouped.set(item.provider, bucket);
    }
    const hydratedGroups = await Promise.all([...grouped.entries()].map(async ([providerId, items]) => {
        const provider = registry.get(providerId);
        if (!provider?.batchGetDecisionSummaries) {
            return [];
        }
        try {
            return await provider.batchGetDecisionSummaries({
                items,
                view: "standard"
            });
        }
        catch {
            return [];
        }
    }));
    const hydratedByKey = new Map(hydratedGroups
        .flat()
        .map((item) => [`${item.provider}:${item.providerId}`, item]));
    let improvedCount = 0;
    const items = result.items.map((item) => {
        const hydrated = hydratedByKey.get(`${item.provider}:${item.providerId}`);
        if (!hydrated) {
            return item;
        }
        if (decisionReadabilityScore(hydrated) > decisionReadabilityScore(item)) {
            improvedCount += 1;
        }
        return hydrated;
    });
    if (improvedCount === 0) {
        return {
            ...result,
            items
        };
    }
    return {
        ...result,
        items,
        coverageNotes: [
            `Hydrated ${improvedCount} search hit(s) with provider detail to recover document/text availability.`,
            ...stripMergedCoverageNotes(result.coverageNotes),
            ...buildMergedCoverageNotes(items)
        ]
    };
}
//# sourceMappingURL=hydrate.js.map