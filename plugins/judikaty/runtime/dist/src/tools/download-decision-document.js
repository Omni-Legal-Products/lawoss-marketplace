import { DownloadDecisionDocumentInputSchema, assertProviderAvailable } from "../domain/provider-contracts.js";
import { UnsupportedProviderError } from "../domain/errors.js";
import { asToolResult } from "../server/response.js";
export function registerDownloadDecisionDocumentTool(server, registry) {
    server.registerTool("download_decision_document", {
        title: "Download Decision Document",
        description: "Resolve the decision document metadata and source URL.",
        inputSchema: DownloadDecisionDocumentInputSchema
    }, async (input) => {
        const parsed = DownloadDecisionDocumentInputSchema.parse(input);
        const provider = assertProviderAvailable(registry, parsed.provider);
        if (!provider.downloadDecisionDocument) {
            throw new UnsupportedProviderError(provider.id);
        }
        return asToolResult(await provider.downloadDecisionDocument(parsed));
    });
}
//# sourceMappingURL=download-decision-document.js.map