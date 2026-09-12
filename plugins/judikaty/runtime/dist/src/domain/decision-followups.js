const DEFAULT_MARKDOWN_WINDOW_CHARS = 12000;
const SAVE_PATH_NOTE = "savePath is resolved on the MCP server host filesystem. In remote HTTP deployments, that path may not exist on the client machine running the agent.";
export function buildDecisionFollowupActions(input) {
    const actions = [];
    if (input.sourceAvailability.documentAvailable) {
        actions.push({
            tool: "download_decision_document",
            reason: "Use this tool for the source PDF or document instead of fetching the public document URL directly.",
            arguments: {
                provider: input.provider,
                id: input.providerId
            }
        });
    }
    if (input.sourceAvailability.textAvailable ||
        input.sourceAvailability.textDerivableFromDocument ||
        input.sourceAvailability.documentAvailable) {
        if (input.reference) {
            actions.push({
                tool: "get_decision_markdown_by_reference",
                reason: "Use bounded markdown windows to read the whole decision in-context. Repeat with nextOffset until windowComplete=true.",
                arguments: {
                    provider: input.provider,
                    reference: input.reference,
                    offsetChars: 0,
                    maxChars: DEFAULT_MARKDOWN_WINDOW_CHARS
                }
            });
            actions.push({
                tool: "export_decision_markdown_by_reference",
                reason: "Use this when you need one stitched markdown export or a savePath write on the MCP server filesystem.",
                arguments: {
                    provider: input.provider,
                    reference: input.reference
                }
            });
        }
        else {
            actions.push({
                tool: "get_decision_markdown",
                reason: "Use bounded markdown windows to read the whole decision in-context. Repeat with nextOffset until windowComplete=true.",
                arguments: {
                    provider: input.provider,
                    id: input.providerId,
                    offsetChars: 0,
                    maxChars: DEFAULT_MARKDOWN_WINDOW_CHARS
                }
            });
            actions.push({
                tool: "export_decision_markdown",
                reason: "Use this when you need one stitched markdown export or a savePath write on the MCP server filesystem.",
                arguments: {
                    provider: input.provider,
                    id: input.providerId
                }
            });
        }
        actions.push({
            tool: "get_decision_text",
            reason: "Use this for paginated text extraction windows when you need bounded text chunks instead of one whole export.",
            arguments: {
                provider: input.provider,
                id: input.providerId
            }
        });
    }
    return actions;
}
export function buildFullTextGuidance(input) {
    if (!input.sourceAvailability.textAvailable &&
        !input.sourceAvailability.textDerivableFromDocument &&
        !input.sourceAvailability.documentAvailable) {
        return {
            available: false,
            preferredTool: null,
            reason: null,
            arguments: null,
            exportTool: null,
            exportReason: null,
            exportArguments: null,
            savePathScope: null,
            savePathNote: null
        };
    }
    if (input.reference) {
        return {
            available: true,
            preferredTool: "get_decision_markdown_by_reference",
            reason: "Use bounded markdown windows to read long decisions in-context without hitting client token limits.",
            arguments: {
                provider: input.provider,
                reference: input.reference,
                offsetChars: 0,
                maxChars: DEFAULT_MARKDOWN_WINDOW_CHARS
            },
            exportTool: "export_decision_markdown_by_reference",
            exportReason: "Use the stitched export tool only when you need one combined markdown document or a savePath write.",
            exportArguments: {
                provider: input.provider,
                reference: input.reference
            },
            savePathScope: "mcp_server_filesystem",
            savePathNote: SAVE_PATH_NOTE
        };
    }
    return {
        available: true,
        preferredTool: "get_decision_markdown",
        reason: "Use bounded markdown windows to read long decisions in-context without hitting client token limits.",
        arguments: {
            provider: input.provider,
            id: input.providerId,
            offsetChars: 0,
            maxChars: DEFAULT_MARKDOWN_WINDOW_CHARS
        },
        exportTool: "export_decision_markdown",
        exportReason: "Use the stitched export tool only when you need one combined markdown document or a savePath write.",
        exportArguments: {
            provider: input.provider,
            id: input.providerId
        },
        savePathScope: "mcp_server_filesystem",
        savePathNote: SAVE_PATH_NOTE
    };
}
//# sourceMappingURL=decision-followups.js.map