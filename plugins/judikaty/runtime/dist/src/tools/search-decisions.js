import { SearchDecisionsInputSchema, resolveSearchProvider } from "../domain/provider-contracts.js";
import { buildUnhonouredFilterCoverageNote, findUnhonouredFilterFields, resolveCapabilityProviderIds } from "../domain/search-filter-capabilities.js";
import { asToolResult } from "../server/response.js";
import { runAutoSearchDecisions } from "./search-decisions/auto.js";
import { appendCoverageNotes, normalizeSearchDecisionsInput } from "./search-decisions/normalize.js";
import { dispatchSingleProviderSearchDecisions } from "./search-decisions/nsud-local-date.js";
import { buildSearchToolOutput } from "./search-decisions/output.js";
export { runAutoSearchDecisions } from "./search-decisions/auto.js";
export { normalizeSearchDecisionsInput } from "./search-decisions/normalize.js";
export { NSUD_DATE_TEXT_COMBO_NOTE, dispatchSingleProviderSearchDecisions, isNsudDateOnlyLocalQuery, runNsudDateOnlyLocalSearch } from "./search-decisions/nsud-local-date.js";
export { annotateSearchOutput, buildSearchToolOutput } from "./search-decisions/output.js";
export { runSingleProviderSearchDecisions } from "./search-decisions/single.js";
/**
 * One coverage note per provider leg that has at least one requested filter
 * field it cannot honour (see domain/search-filter-capabilities.ts) --
 * the structural guard against this project's recurring bug class of a
 * requested filter silently not being applied. For `provider="auto"` this
 * checks both the justice and nsud legs independently, since one can have a
 * gap the other does not (e.g. justice honours legalArea, nsud does not).
 */
export function buildCapabilityCoverageNotes(input) {
    return resolveCapabilityProviderIds(input.provider).flatMap((providerId) => {
        const fields = findUnhonouredFilterFields(input, providerId);
        return fields.length > 0 ? [buildUnhonouredFilterCoverageNote(providerId, fields)] : [];
    });
}
/**
 * The full `search_decisions` request/response pipeline, exported as a
 * plain function (rather than only living inside `registerTool`'s
 * callback) so it can be unit-tested directly and so the MCP registration
 * boilerplate below stays a thin wrapper.
 */
export async function runSearchDecisionsTool(input, registry) {
    const normalized = normalizeSearchDecisionsInput(input);
    const capabilityNotes = buildCapabilityCoverageNotes(normalized.input);
    const extraCoverageNotes = [...normalized.coverageNotes, ...capabilityNotes];
    if (normalized.input.provider === "auto") {
        const justice = registry.get("justice");
        const nsud = registry.get("nsud");
        if (!justice || !nsud) {
            throw new Error("Auto provider mode requires both justice and nsud providers.");
        }
        const result = appendCoverageNotes(await runAutoSearchDecisions(normalized.input, [
            { id: "justice", provider: justice },
            { id: "nsud", provider: nsud }
        ]), extraCoverageNotes);
        return buildSearchToolOutput(result, normalized.input, registry);
    }
    const providerId = resolveSearchProvider(normalized.input.provider);
    const provider = registry.get(providerId);
    if (!provider) {
        throw new Error(`Provider '${providerId}' is not registered.`);
    }
    const result = await dispatchSingleProviderSearchDecisions(normalized.input, providerId, provider);
    return buildSearchToolOutput(appendCoverageNotes(result, extraCoverageNotes), normalized.input, registry);
}
export function registerSearchDecisionsTool(server, registry) {
    server.registerTool("search_decisions", {
        title: "Search Decisions",
        description: "Search Slovak court decisions across available providers. view=compact je rýchly a token-úsporný " +
            "(žiadne sieťové dohľadávanie, ~10× menšia odpoveď); view=standard/full zachováva plné metadáta a " +
            "text-readiness enrichment.",
        inputSchema: SearchDecisionsInputSchema
    }, async (input) => {
        const parsed = SearchDecisionsInputSchema.parse(input);
        return asToolResult(await runSearchDecisionsTool(parsed, registry));
    });
}
//# sourceMappingURL=search-decisions.js.map