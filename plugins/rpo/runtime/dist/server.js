import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRpoMcpServer } from "./mcp-server.js";
import { safeErrorClass, safeOperationalLog } from "./redaction.js";
async function main() {
    const server = createRpoMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    safeOperationalLog("error", "stdio_startup_failed", {
        operation: "stdio_startup",
        status: 500,
        errorClass: safeErrorClass(error),
    });
    process.exit(1);
});
