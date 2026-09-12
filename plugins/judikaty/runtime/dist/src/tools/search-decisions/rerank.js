import { decisionReadabilityScore } from "./readability.js";
export function rerankSearchResultsForReadability(result) {
    const rerankedItems = [...result.items].sort(compareDecisionReadability);
    const originalOrder = result.items.map((item) => `${item.provider}:${item.providerId}`).join("|");
    const rerankedOrder = rerankedItems
        .map((item) => `${item.provider}:${item.providerId}`)
        .join("|");
    if (originalOrder === rerankedOrder) {
        return result;
    }
    return {
        ...result,
        items: rerankedItems,
        coverageNotes: [
            "Search results were re-ranked to prefer text-ready or extractable decisions over metadata-only hits.",
            ...result.coverageNotes
        ]
    };
}
function compareDecisionReadability(a, b) {
    const scoreDiff = decisionReadabilityScore(b) - decisionReadabilityScore(a);
    if (scoreDiff !== 0) {
        return scoreDiff;
    }
    const dateA = a.dateIssued ?? "";
    const dateB = b.dateIssued ?? "";
    return dateB.localeCompare(dateA);
}
//# sourceMappingURL=rerank.js.map