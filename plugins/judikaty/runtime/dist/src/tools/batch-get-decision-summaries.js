import { BatchGetDecisionSummariesInputSchema, assertProviderAvailable } from "../domain/provider-contracts.js";
import { UnsupportedProviderError } from "../domain/errors.js";
import { presentBatchSummaries } from "../server/presenters.js";
import { asToolResult } from "../server/response.js";
export function registerBatchGetDecisionSummariesTool(server, registry) {
    server.registerTool("batch_get_decision_summaries", {
        title: "Batch Get Decision Summaries",
        description: "Fetch normalized summary-level data for a shortlist of decisions.",
        inputSchema: BatchGetDecisionSummariesInputSchema
    }, async (input) => {
        const parsed = BatchGetDecisionSummariesInputSchema.parse(input);
        const providers = [...new Set(parsed.items.map((item) => item.provider))];
        if (providers.length !== 1) {
            throw new Error("Mixed-provider batch requests are not implemented yet.");
        }
        const provider = assertProviderAvailable(registry, providers[0]);
        if (!provider.batchGetDecisionSummaries) {
            throw new UnsupportedProviderError(provider.id);
        }
        return asToolResult(presentBatchSummaries(await provider.batchGetDecisionSummaries(parsed), parsed.view));
    });
}
//# sourceMappingURL=batch-get-decision-summaries.js.map