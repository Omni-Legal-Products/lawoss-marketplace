#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
async function main() {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Logs go to stderr only; stdout is for MCP protocol.
    process.stderr.write(`[crz-mcp] stdio server ready\n`);
}
main().catch((err) => {
    process.stderr.write(`[crz-mcp] fatal: ${err.stack ?? String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map