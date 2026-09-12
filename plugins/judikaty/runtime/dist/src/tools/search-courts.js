import { SearchCourtsInputSchema } from "../domain/provider-contracts.js";
import { assertProviderAvailable } from "../domain/provider-contracts.js";
import { UnsupportedProviderError } from "../domain/errors.js";
import { asToolResult } from "../server/response.js";
export function registerSearchCourtsTool(server, registry) {
    server.registerTool("search_courts", {
        title: "Search Courts",
        description: "Search Slovak courts and return normalized court metadata.",
        inputSchema: SearchCourtsInputSchema
    }, async (input) => {
        const parsed = SearchCourtsInputSchema.parse(input);
        const provider = assertProviderAvailable(registry, parsed.provider === "auto" ? "justice" : parsed.provider);
        if (!provider.searchCourts) {
            throw new UnsupportedProviderError(provider.id);
        }
        return asToolResult(await provider.searchCourts(parsed));
    });
}
//# sourceMappingURL=search-courts.js.map