import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createOvMcpServer } from "./mcp-server.js";
import { createRequestRateLimiter, STDIO_RATE_LIMIT_KEY } from "./rate-limiter.js";
import { safeLog } from "./redaction.js";
async function main() {
    const server = createOvMcpServer({ rateLimiter: createRequestRateLimiter(), rateLimitKey: STDIO_RATE_LIMIT_KEY });
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch(() => {
    console.error(safeLog("stdio_start_failed"));
    process.exit(1);
});
