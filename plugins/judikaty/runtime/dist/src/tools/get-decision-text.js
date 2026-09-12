import { GetDecisionTextInputSchema, assertProviderAvailable } from "../domain/provider-contracts.js";
import { UnsupportedProviderError } from "../domain/errors.js";
import { asToolResult } from "../server/response.js";
import { readDecisionTextWindow } from "../domain/decision-text-cache.js";
export function registerGetDecisionTextTool(server, registry) {
    server.registerTool("get_decision_text", {
        title: "Get Decision Text",
        description: "Return inline or PDF-extracted decision text in bounded windows. Use this for paginated full-text extraction when a detail response says text is derivable from the document.",
        inputSchema: GetDecisionTextInputSchema
    }, async (input) => {
        const parsed = GetDecisionTextInputSchema.parse(input);
        const provider = assertProviderAvailable(registry, parsed.provider);
        if (!provider.getDecisionText) {
            throw new UnsupportedProviderError(provider.id);
        }
        return asToolResult(await readDecisionTextWindow({
            provider: parsed.provider,
            id: parsed.id,
            offsetChars: parsed.offsetChars,
            maxChars: parsed.maxChars,
            // Called through the provider, never detached: the real providers reach
            // a private field, so a bare method reference loses `this` and throws.
            fetchWindow: (args) => provider.getDecisionText(args)
        }));
    });
}
//# sourceMappingURL=get-decision-text.js.map