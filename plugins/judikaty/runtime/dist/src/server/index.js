import { enforceSupportedNodeVersion } from "./node-version.js";
async function main() {
    // Check the Node version before the rest of the server is loaded: the sqlite
    // dependent modules cannot even be imported on Node older than 22.13.
    if (!enforceSupportedNodeVersion()) {
        return;
    }
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const { ensureKeepAliveAgentInstalled } = await import("../infra/fetch-agent.js");
    const { loadServerConfig } = await import("./config.js");
    const { createApplicationServer } = await import("./factory.js");
    ensureKeepAliveAgentInstalled();
    // stdio is the local mode: it needs no OAuth settings, unlike the HTTP entry.
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