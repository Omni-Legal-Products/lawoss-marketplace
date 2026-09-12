import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createOrsrMcpServer } from "./mcp-server.js";
async function main() {
    const server = createOrsrMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    console.error("Failed to start ORSR MCP stdio server:", error);
    process.exit(1);
});
