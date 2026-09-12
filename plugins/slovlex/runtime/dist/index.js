import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSlovLexMcpServer } from "./server.js";
async function main() {
    const server = createSlovLexMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
