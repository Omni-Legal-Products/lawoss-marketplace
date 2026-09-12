import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDefaultProviderRegistry } from "../providers/registry.js";
import { registerTools } from "./tool-registry.js";
export function createApplicationServer(config) {
    const registry = createDefaultProviderRegistry();
    const server = new McpServer({
        name: config.name,
        version: config.version
    }, {
        capabilities: {
            logging: {}
        }
    });
    registerTools(server, registry);
    return { server, registry };
}
//# sourceMappingURL=factory.js.map