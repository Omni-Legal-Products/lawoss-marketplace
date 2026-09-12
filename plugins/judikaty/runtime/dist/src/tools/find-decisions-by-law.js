import { FindDecisionsByLawInputSchema, assertProviderAvailable } from "../domain/provider-contracts.js";
import { buildLawSearchFallbackBoundary } from "../domain/fallback-boundary.js";
import { mergeSearchDecisionResults } from "../domain/merge.js";
import { UnsupportedProviderError } from "../domain/errors.js";
import { presentSearchResult } from "../server/presenters.js";
import { asToolResult } from "../server/response.js";
export function registerFindDecisionsByLawTool(server, registry) {
    server.registerTool("find_decisions_by_law", {
        title: "Find Decisions By Law",
        description: "Find decisions by law reference or Slov-Lex-aligned paragraph reference. For nsud, candidate decisions are discovered via NS SR fulltext search and then filtered by citations extracted from full decision text.",
        inputSchema: FindDecisionsByLawInputSchema
    }, async (input) => {
        const parsed = FindDecisionsByLawInputSchema.parse(input);
        if (parsed.provider === "auto") {
            const justice = assertProviderAvailable(registry, "justice");
            const nsud = assertProviderAvailable(registry, "nsud");
            if (!justice.findDecisionsByLaw || !nsud.findDecisionsByLaw) {
                throw new Error("Auto provider mode requires law-search support in justice and nsud.");
            }
            const result = await runAutoLawSearch(parsed, [
                { id: "justice", provider: justice },
                { id: "nsud", provider: nsud }
            ]);
            return asToolResult(annotateLawSearchOutput(result, parsed));
        }
        const provider = assertProviderAvailable(registry, parsed.provider);
        if (!provider.findDecisionsByLaw) {
            throw new UnsupportedProviderError(provider.id);
        }
        return asToolResult(annotateLawSearchOutput(await provider.findDecisionsByLaw(parsed), parsed));
    });
}
export async function runAutoLawSearch(input, providers) {
    const settled = await Promise.allSettled(providers.map(({ id, provider }) => provider.findDecisionsByLaw?.({ ...input, provider: id })));
    const successfulResults = [];
    const failureNotes = [];
    settled.forEach((result, index) => {
        const providerId = providers[index]?.id ?? "unknown";
        if (result.status === "fulfilled" && result.value) {
            successfulResults.push(result.value);
            return;
        }
        const error = result.status === "rejected" ? result.reason : `Provider '${providerId}' returned no result.`;
        failureNotes.push(`Auto law search could not retrieve ${providerId} results: ${formatProviderError(error)}`);
    });
    if (successfulResults.length === 0) {
        throw new Error(failureNotes.length > 0
            ? failureNotes.join(" | ")
            : "Auto law search failed before any provider returned a result.");
    }
    const merged = mergeSearchDecisionResults(successfulResults);
    return {
        ...merged,
        coverageNotes: [...merged.coverageNotes, ...failureNotes]
    };
}
export function annotateLawSearchOutput(result, input) {
    const presented = presentSearchResult(result, input.view);
    const fallbackBoundary = buildLawSearchFallbackBoundary(input, result.total);
    const fallbackMetadata = result;
    if (!fallbackBoundary) {
        return {
            ...presented,
            ...(fallbackMetadata.fallbackUsed !== undefined
                ? { fallbackUsed: fallbackMetadata.fallbackUsed }
                : {}),
            ...(fallbackMetadata.fallbackQuery !== undefined
                ? { fallbackQuery: fallbackMetadata.fallbackQuery }
                : {}),
            ...(fallbackMetadata.fallbackQueriesTried
                ? { fallbackQueriesTried: fallbackMetadata.fallbackQueriesTried }
                : {})
        };
    }
    return {
        ...presented,
        ...(fallbackMetadata.fallbackUsed !== undefined
            ? { fallbackUsed: fallbackMetadata.fallbackUsed }
            : {}),
        ...(fallbackMetadata.fallbackQuery !== undefined
            ? { fallbackQuery: fallbackMetadata.fallbackQuery }
            : {}),
        ...(fallbackMetadata.fallbackQueriesTried
            ? { fallbackQueriesTried: fallbackMetadata.fallbackQueriesTried }
            : {}),
        fallbackBoundary
    };
}
function formatProviderError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === "string" ? error : "Unknown provider error.";
}
//# sourceMappingURL=find-decisions-by-law.js.map