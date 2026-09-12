import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRpvsMcpServer } from "./mcp-server.js";
import { safeLogEvent } from "./redaction.js";
async function main() {
    const server = createRpvsMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch(() => {
    safeLogEvent("stdio_startup_failed", { errorCode: "STARTUP_FAILED" });
    process.exit(1);
});
