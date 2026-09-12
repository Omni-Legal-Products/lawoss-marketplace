import { buildFullTextGuidance } from "../domain/decision-followups.js";
import { ExportDecisionMarkdownInputSchema, assertProviderAvailable } from "../domain/provider-contracts.js";
import { UnsupportedProviderError } from "../domain/errors.js";
import { buildDefaultMarkdownExportPath, exportWholeDecisionMarkdown } from "../infra/markdown-export.js";
import { asToolResult } from "../server/response.js";
import { buildWholeDecisionToolPayload } from "./whole-decision-tool-payload.js";
export function registerExportDecisionMarkdownTool(server, registry) {
    server.registerTool("export_decision_markdown", {
        title: "Export Decision Markdown",
        description: "Export stitched full-decision markdown for a known provider-local decision ID. Prefer get_decision_markdown for in-model reading of long decisions; use this for stitched export or savePath output.",
        inputSchema: ExportDecisionMarkdownInputSchema
    }, async (input) => runExportDecisionMarkdown(input, registry));
    server.registerTool("get_decision_full_text", {
        title: "Get Decision Full Text",
        description: "Compatibility alias for export_decision_markdown. Whole-decision outputs can exceed client token budgets; prefer get_decision_markdown for reading, and treat savePath as MCP-server filesystem output.",
        inputSchema: ExportDecisionMarkdownInputSchema
    }, async (input) => runExportDecisionMarkdown(input, registry));
}
export async function runExportDecisionMarkdown(input, registry) {
    const parsed = ExportDecisionMarkdownInputSchema.parse(input);
    const provider = assertProviderAvailable(registry, parsed.provider);
    if (!provider.getDecisionText) {
        throw new UnsupportedProviderError(provider.id);
    }
    const detail = await provider.getDecisionDetail({
        provider: parsed.provider,
        id: parsed.id,
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
            provider: parsed.provider,
            id: parsed.id,
            offsetChars,
            maxChars
        })
    });
    const fullTextGuidance = buildFullTextGuidance({
        provider: parsed.provider,
        providerId: parsed.id,
        sourceAvailability: detail.sourceAvailability
    });
    return asToolResult(buildWholeDecisionToolPayload({
        exported,
        fullTextGuidance
    }));
}
//# sourceMappingURL=export-decision-markdown.js.map