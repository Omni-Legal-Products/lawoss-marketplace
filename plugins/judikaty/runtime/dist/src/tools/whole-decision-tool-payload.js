const SAVE_PATH_NOTE = "savePath is resolved on the MCP server host filesystem. In remote HTTP deployments, that path may not exist on the client machine running the agent.";
export function buildWholeDecisionToolPayload(input) {
    return {
        ...(typeof input.matched === "boolean" ? { matched: input.matched } : {}),
        ...(input.reference ? { reference: input.reference } : {}),
        ...(input.resolved ? { resolved: input.resolved } : {}),
        provider: input.exported.provider,
        id: input.exported.id,
        windowCount: input.exported.windowCount,
        complete: input.exported.complete,
        truncated: input.exported.truncated,
        continueFromOffset: input.exported.continueFromOffset,
        sourceMode: input.exported.sourceMode,
        textSha256: input.exported.textSha256,
        savedPath: input.exported.savedPath,
        ...(input.exported.savedPath
            ? {
                savedPathScope: "mcp_server_filesystem",
                savedPathNote: SAVE_PATH_NOTE
            }
            : {}),
        ...(input.fullTextGuidance ? { readingGuidance: input.fullTextGuidance } : {}),
        markdown: input.exported.markdown
    };
}
//# sourceMappingURL=whole-decision-tool-payload.js.map