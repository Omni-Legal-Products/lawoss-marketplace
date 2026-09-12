import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ensureKeepAliveAgentInstalled } from "../infra/fetch-agent.js";
import { loadServerConfig } from "./config.js";
import { createApplicationServer } from "./factory.js";
async function main() {
    ensureKeepAliveAgentInstalled();
    const config = loadServerConfig({ transport: "stdio" });
    const { server } = createApplicationServer(config);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`${config.name} MCP server running on stdio`);
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map