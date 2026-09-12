import { GetDecisionTextInputSchema, assertProviderAvailable } from "../domain/provider-contracts.js";
import { UnsupportedProviderError } from "../domain/errors.js";
import { buildDecisionMarkdownWindow } from "../infra/markdown.js";
import { asToolResult } from "../server/response.js";
export function registerGetDecisionMarkdownTool(server, registry) {
    server.registerTool("get_decision_markdown", {
        title: "Get Decision Markdown",
        description: "Return one bounded markdown window for the decision text. Repeat with nextOffset until windowComplete=true to read the whole decision in-context.",
        inputSchema: GetDecisionTextInputSchema
    }, async (input) => {
        const parsed = GetDecisionTextInputSchema.parse(input);
        const provider = assertProviderAvailable(registry, parsed.provider);
        if (!provider.getDecisionText) {
            throw new UnsupportedProviderError(provider.id);
        }
        const [detail, textWindow] = await Promise.all([
            provider.getDecisionDetail({
                provider: parsed.provider,
                id: parsed.id,
                view: "standard",
                include: ["document", "citedRegulations"]
            }),
            provider.getDecisionText(parsed)
        ]);
        return asToolResult(buildDecisionMarkdownWindow({
            detail,
            textWindow,
            includeMetadata: parsed.offsetChars === 0
        }));
    });
}
//# sourceMappingURL=get-decision-markdown.js.map