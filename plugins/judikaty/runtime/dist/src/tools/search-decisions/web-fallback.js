import { fetchWebPreview, searchDuckDuckGoHtml } from "../../infra/web-search.js";
const MAX_WEB_FALLBACK_DECISIONS = 2;
const MAX_HITS_PER_DECISION = 3;
const PREVIEW_MAX_CHARS = 1200;
export async function buildWebFallback(blockedMatches) {
    const candidates = await Promise.all(blockedMatches.slice(0, MAX_WEB_FALLBACK_DECISIONS).map(async (decision) => {
        const queryPlan = buildDecisionWebFallbackQueries(decision);
        try {
            let selectedQuery = queryPlan[0] ?? "";
            let hits = [];
            for (const query of queryPlan) {
                selectedQuery = query;
                hits = await searchDuckDuckGoHtml({ query, limit: MAX_HITS_PER_DECISION });
                if (hits.length > 0) {
                    break;
                }
            }
            const enrichedHits = await Promise.all(hits.map(async (hit, index) => {
                if (hit.snippet || index > 0) {
                    return {
                        ...hit,
                        previewSourceMode: null,
                        textPreview: null
                    };
                }
                const preview = await fetchWebPreview({ url: hit.url, maxChars: PREVIEW_MAX_CHARS });
                return {
                    ...hit,
                    previewSourceMode: preview.sourceMode,
                    textPreview: preview.textPreview
                };
            }));
            return {
                decision,
                query: selectedQuery,
                queriesTried: queryPlan,
                hits: enrichedHits
            };
        }
        catch {
            return {
                decision,
                query: queryPlan[0] ?? "",
                queriesTried: queryPlan,
                hits: []
            };
        }
    }));
    if (candidates.every((candidate) => candidate.hits.length === 0)) {
        return null;
    }
    return {
        attempted: true,
        engine: "duckduckgo_html",
        notes: [
            "Official providers returned metadata-only hits, so a best-effort public web search fallback was attempted.",
            "Web fallback results are secondary leads, not canonical provider data. Verify provenance before relying on them."
        ],
        candidates
    };
}
function buildDecisionWebFallbackQueries(decision) {
    const year = decision.dateIssued?.slice(0, 4);
    const quotedSpis = decision.spisovaZnacka ? `"${decision.spisovaZnacka}"` : null;
    const bareSpis = decision.spisovaZnacka ?? null;
    const quotedCourt = decision.courtName ? `"${decision.courtName}"` : null;
    return [
        [quotedSpis, quotedCourt, year, "rozhodnutie"],
        [quotedSpis, "rozhodnutie"],
        [bareSpis, "rozhodnutie"],
        [bareSpis?.replaceAll("/", " "), "rozhodnutie"]
    ]
        .map((parts) => parts.filter((part) => Boolean(part)).join(" ").trim())
        .filter((query, index, all) => query.length > 0 && all.indexOf(query) === index);
}
//# sourceMappingURL=web-fallback.js.map