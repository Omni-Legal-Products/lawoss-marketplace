import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDisqMcpServer } from "./mcp-server.js";
import { createRequestRateLimiter, STDIO_RATE_LIMIT_KEY } from "./rate-limiter.js";
import { safeLog } from "./redaction.js";
export async function startStdioServer(transport = new StdioServerTransport()) {
    const server = createDisqMcpServer({ rateLimiter: createRequestRateLimiter(), rateLimitKey: STDIO_RATE_LIMIT_KEY });
    await server.connect(transport);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    startStdioServer().catch(() => { console.error(safeLog("stdio_start_failed")); process.exit(1); });
}
