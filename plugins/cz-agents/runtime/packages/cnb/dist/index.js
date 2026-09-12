#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildCnbServer } from './server.js';
async function main() {
    const server = buildCnbServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[cz-agents/cnb] MCP server ready on stdio');
}
main().catch((err) => {
    console.error('[cz-agents/cnb] fatal:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map