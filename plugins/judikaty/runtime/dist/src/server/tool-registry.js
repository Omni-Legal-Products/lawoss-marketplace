import { recordToolCall } from "../providers/nsud/law-index-store.js";
import { registerAutocompleteDecisionsTool } from "../tools/autocomplete-decisions.js";
import { registerBatchGetDecisionSummariesTool } from "../tools/batch-get-decision-summaries.js";
import { registerDownloadDecisionDocumentTool } from "../tools/download-decision-document.js";
import { registerExportDecisionMarkdownTool } from "../tools/export-decision-markdown.js";
import { registerExportDecisionMarkdownByReferenceTool } from "../tools/export-decision-markdown-by-reference.js";
import { registerFindDecisionsByLawTool } from "../tools/find-decisions-by-law.js";
import { registerGetCaseChainTool } from "../tools/get-case-chain.js";
import { registerGetDecisionByReferenceTool } from "../tools/get-decision-by-reference.js";
import { registerGetDecisionDetailTool } from "../tools/get-decision-detail.js";
import { registerGetDecisionMarkdownByReferenceTool } from "../tools/get-decision-markdown-by-reference.js";
import { registerGetDecisionMarkdownTool } from "../tools/get-decision-markdown.js";
import { registerGetDecisionTextTool } from "../tools/get-decision-text.js";
import { registerGetDecisionTreatmentTool } from "../tools/get-decision-treatment.js";
import { registerGetNsudIndexStatsTool } from "../tools/get-nsud-index-stats.js";
import { registerGetProviderHealthTool } from "../tools/get-provider-health.js";
import { registerManageWatchlistTool } from "../tools/manage-watchlist.js";
import { registerRelatedSlovlexContextTool } from "../tools/related-slovlex-context.js";
import { registerResolveDecisionIdentityTool } from "../tools/resolve-decision-identity.js";
import { registerSearchCourtsTool } from "../tools/search-courts.js";
import { registerSearchDecisionTextTool } from "../tools/search-decision-text.js";
import { registerSearchDecisionsTool } from "../tools/search-decisions.js";
import { registerGetTreatmentIndexStatsTool } from "../tools/treatment-index-stats.js";
/**
 * Count every tool call, without touching any of the 24 tool files.
 *
 * `registerTools` is the single place every tool passes through, so wrapping
 * `registerTool` here instruments all of them at once. This exists because the repo's
 * own Tool Consolidation Gate says the collapse from ~24 tools to ~12 waits for usage
 * data — and nothing was counting, so that data could never arrive. Deleting a tool
 * nobody calls is safe; deleting one on a guess is not.
 */
function withCallCounting(server) {
    const original = server.registerTool.bind(server);
    server.registerTool = ((name, config, handler) => original(name, config, (async (...args) => {
        // Recording must never interfere with the call itself.
        await recordToolCall(name);
        return await handler(...args);
    })));
    return server;
}
export function registerTools(server, registry) {
    registerAllTools(withCallCounting(server), registry);
}
function registerAllTools(server, registry) {
    registerSearchDecisionsTool(server, registry);
    registerSearchDecisionTextTool(server);
    registerGetDecisionDetailTool(server, registry);
    registerGetDecisionByReferenceTool(server, registry);
    registerGetDecisionMarkdownByReferenceTool(server, registry);
    registerGetDecisionMarkdownTool(server, registry);
    registerExportDecisionMarkdownTool(server, registry);
    registerExportDecisionMarkdownByReferenceTool(server, registry);
    registerSearchCourtsTool(server, registry);
    registerAutocompleteDecisionsTool(server, registry);
    registerResolveDecisionIdentityTool(server, registry);
    registerBatchGetDecisionSummariesTool(server, registry);
    registerFindDecisionsByLawTool(server, registry);
    registerDownloadDecisionDocumentTool(server, registry);
    registerGetDecisionTextTool(server, registry);
    registerRelatedSlovlexContextTool(server, registry);
    registerGetProviderHealthTool(server, registry);
    registerGetNsudIndexStatsTool(server);
    registerGetTreatmentIndexStatsTool(server);
    registerManageWatchlistTool(server);
    registerGetCaseChainTool(server);
    registerGetDecisionTreatmentTool(server);
}
//# sourceMappingURL=tool-registry.js.map