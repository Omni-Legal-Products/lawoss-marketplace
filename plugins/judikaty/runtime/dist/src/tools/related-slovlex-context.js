import { RelatedSlovlexContextInputSchema, assertProviderAvailable } from "../domain/provider-contracts.js";
import { UnsupportedProviderError } from "../domain/errors.js";
import { asToolResult } from "../server/response.js";
export function registerRelatedSlovlexContextTool(server, registry) {
    server.registerTool("related_slovlex_context", {
        title: "Related Slov-Lex Context",
        description: "Prepare normalized cited-law context for Slov-Lex follow-up calls.",
        inputSchema: RelatedSlovlexContextInputSchema
    }, async (input) => {
        const parsed = RelatedSlovlexContextInputSchema.parse(input);
        const provider = assertProviderAvailable(registry, parsed.provider);
        if (!provider.relatedSlovlexContext) {
            throw new UnsupportedProviderError(parsed.provider);
        }
        return asToolResult(await provider.relatedSlovlexContext(parsed));
    });
}
//# sourceMappingURL=related-slovlex-context.js.map