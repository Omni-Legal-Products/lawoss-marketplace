#!/usr/bin/env node
/**
 * EUR-Lex CELEX MCP Server — stdio transport
 *
 * Provides 12 tools for EU legislation access:
 * citation validation, document retrieval, version history,
 * multilingual comparison, full-text search, and ELI resolution.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCacheFromDisk, dumpCacheToDisk } from "./cache.js";
import { registerCitationTools } from "./citation-tools.js";
import { registerDocumentTools } from "./document-tools.js";
import { registerSearchTools } from "./search-tools.js";
// ─── Create server ──────────────────────────────────────────────────────────
const server = new McpServer({
    name: "eurlex-celex-mcp-server",
    version: "1.0.0",
});
// ─── Register all tools ──────────────────────────────────────────────────────
registerCitationTools(server);
registerDocumentTools(server);
registerSearchTools(server);
// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
    // Load persisted cache from disk
    loadCacheFromDisk();
    // Persist cache on shutdown
    process.on("SIGINT", () => {
        console.error("[eurlex-mcp] Shutting down, saving cache...");
        dumpCacheToDisk();
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        dumpCacheToDisk();
        process.exit(0);
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[eurlex-mcp] EUR-Lex CELEX MCP Server running via stdio");
    console.error("[eurlex-mcp] Web Service credentials:", process.env.EURLEX_WS_USERNAME ? "✅ configured" : "⚠️  not configured (search_full_text unavailable)");
}
main().catch((error) => {
    console.error("[eurlex-mcp] Fatal error:", error);
    process.exit(1);
});
//# sourceMappingURL=server.js.map