import { buildFullTextGuidance } from "../domain/decision-followups.js";
import { ExportDecisionMarkdownByReferenceInputSchema, assertProviderAvailable } from "../domain/provider-contracts.js";
import { buildReferenceFallbackBoundary } from "../domain/fallback-boundary.js";
import { UnsupportedProviderError } from "../domain/errors.js";
import { buildDefaultMarkdownExportPath, exportWholeDecisionMarkdown } from "../infra/markdown-export.js";
import { asToolResult } from "../server/response.js";
import { resolveByReference } from "./get-decision-by-reference.js";
import { buildWholeDecisionToolPayload } from "./whole-decision-tool-payload.js";
export function registerExportDecisionMarkdownByReferenceTool(server, registry) {
    server.registerTool("export_decision_markdown_by_reference", {
        title: "Export Decision Markdown By Reference",
        description: "Resolve a decision by reference and export stitched full-decision markdown. Prefer get_decision_markdown_by_reference for in-model reading of long decisions; use this for stitched export or savePath output.",
        inputSchema: ExportDecisionMarkdownByReferenceInputSchema
    }, async (input) => runExportDecisionMarkdownByReference(input, registry));
    server.registerTool("get_decision_full_text_by_reference", {
        title: "Get Decision Full Text By Reference",
        description: "Compatibility alias for export_decision_markdown_by_reference. Whole-decision outputs can exceed client token budgets; prefer get_decision_markdown_by_reference for reading, and treat savePath as MCP-server filesystem output.",
        inputSchema: ExportDecisionMarkdownByReferenceInputSchema
    }, async (input) => runExportDecisionMarkdownByReference(input, registry));
}
export async function runExportDecisionMarkdownByReference(input, registry) {
    const parsed = ExportDecisionMarkdownByReferenceInputSchema.parse(input);
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
        throw new UnsupportedProviderError(provider.id);
    }
    const detail = await provider.getDecisionDetail({
        provider: identity.provider,
        id: identity.providerId,
        view: "standard",
        include: ["document", "citedRegulations"]
    });
    const resolvedSavePath = parsed.savePath ?? (parsed.saveToDefaultPath ? buildDefaultMarkdownExportPath(detail) : null);
    const exported = await exportWholeDecisionMarkdown({
        detail,
        windowChars: parsed.windowChars,
        maxCharsTotal: parsed.maxCharsTotal,
        ...(resolvedSavePath ? { savePath: resolvedSavePath } : {}),
        getTextWindow: ({ offsetChars, maxChars }) => provider.getDecisionText({
            provider: identity.provider,
            id: identity.providerId,
            offsetChars,
            maxChars
        })
    });
    const fullTextGuidance = buildFullTextGuidance({
        provider: identity.provider,
        providerId: identity.providerId,
        reference: parsed.reference,
        sourceAvailability: detail.sourceAvailability
    });
    return asToolResult(buildWholeDecisionToolPayload({
        matched: true,
        reference: parsed.reference,
        resolved: identity,
        exported,
        fullTextGuidance
    }));
}
//# sourceMappingURL=export-decision-markdown-by-reference.js.map