import { GetDecisionMarkdownByReferenceInputSchema, assertProviderAvailable } from "../domain/provider-contracts.js";
import { buildReferenceFallbackBoundary } from "../domain/fallback-boundary.js";
import { buildDecisionMarkdownWindow } from "../infra/markdown.js";
import { asToolResult } from "../server/response.js";
import { resolveByReference } from "./get-decision-by-reference.js";
export function registerGetDecisionMarkdownByReferenceTool(server, registry) {
    server.registerTool("get_decision_markdown_by_reference", {
        title: "Get Decision Markdown By Reference",
        description: "Resolve a decision by reference and return one bounded markdown window. Repeat with nextOffset until windowComplete=true to read the whole decision in-context.",
        inputSchema: GetDecisionMarkdownByReferenceInputSchema
    }, async (input) => {
        const parsed = GetDecisionMarkdownByReferenceInputSchema.parse(input);
        const identity = await resolveByReference({
            provider: parsed.provider,
            reference: parsed.reference,
            view: "standard",
            include: ["document", "citedRegulations"]
        }, registry);
        if (!identity.matched || !identity.provider || !identity.providerId) {
            const fallbackBoundary = buildReferenceFallbackBoundary({
                provider: parsed.provider,
                reference: parsed.reference,
                resolution: identity
            });
            return asToolResult({
                matched: false,
                reference: parsed.reference,
                notes: identity.notes,
                ...(fallbackBoundary ? { fallbackBoundary } : {})
            });
        }
        const provider = assertProviderAvailable(registry, identity.provider);
        if (!provider.getDecisionText) {
            throw new Error(`Provider '${provider.id}' does not support getDecisionText.`);
        }
        const [detail, textWindow] = await Promise.all([
            provider.getDecisionDetail({
                provider: identity.provider,
                id: identity.providerId,
                view: "standard",
                include: ["document", "citedRegulations"]
            }),
            provider.getDecisionText({
                provider: identity.provider,
                id: identity.providerId,
                maxChars: parsed.maxChars,
                offsetChars: parsed.offsetChars
            })
        ]);
        return asToolResult({
            matched: true,
            reference: parsed.reference,
            resolved: identity,
            ...buildDecisionMarkdownWindow({
                detail,
                textWindow,
                includeMetadata: parsed.offsetChars === 0
            })
        });
    });
}
//# sourceMappingURL=get-decision-markdown-by-reference.js.map