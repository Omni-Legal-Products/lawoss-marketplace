import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRuMcpServer } from "./mcp-server.js";
import { safeLogEvent } from "./redaction.js";
async function main() {
    const server = createRuMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch(() => {
    safeLogEvent("stdio_start_failed", { errorCode: "RU_INTERNAL" });
    process.exit(1);
});
