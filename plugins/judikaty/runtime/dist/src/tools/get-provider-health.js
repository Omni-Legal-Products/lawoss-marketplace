import * as z from "zod/v4";
import { GetProviderHealthResultSchema } from "../domain/provider-contracts.js";
import { buildProviderHealth, getProviderCapabilities, getProviderCoverageProfile } from "../domain/provider-health.js";
import { asToolResult } from "../server/response.js";
export function registerGetProviderHealthTool(server, registry) {
    server.registerTool("get_provider_health", {
        title: "Get Provider Health",
        description: "Return current provider availability for judiciary sources.",
        inputSchema: z.object({})
    }, async () => {
        const items = await Promise.all(registry.list().map(async (provider) => provider.getProviderHealth
            ? provider.getProviderHealth()
            : buildProviderHealth({
                provider: provider.id,
                available: false,
                capabilities: getProviderCapabilities(provider.id),
                coverage: getProviderCoverageProfile(provider.id),
                notes: ["Health check is not implemented."]
            })));
        return asToolResult(GetProviderHealthResultSchema.parse({ items }));
    });
}
//# sourceMappingURL=get-provider-health.js.map