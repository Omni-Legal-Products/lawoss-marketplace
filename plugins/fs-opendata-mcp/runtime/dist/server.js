import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFsMcpServer } from "./mcp-server.js";
import { createRequestRateLimiter, STDIO_RATE_LIMIT_KEY } from "./rate-limiter.js";
async function main() {
    const server = createFsMcpServer({ rateLimiter: createRequestRateLimiter(), rateLimitKey: STDIO_RATE_LIMIT_KEY });
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    console.error("Failed to start FS MCP stdio server:", error);
    process.exit(1);
});
