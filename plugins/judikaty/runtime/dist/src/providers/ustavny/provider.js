import { PlaceholderProvider } from "../placeholder.js";
import { courtNamesMatch } from "../../domain/court-name-match.js";
import { buildProviderHealth, getProviderCapabilities, getProviderCoverageProfile } from "../../domain/provider-health.js";
import { UstavnyClient } from "./client.js";
import { USTAVNY_COURT_NAME, mapUstavnyDecisionDetail, mapUstavnyDecisionSummary, mapUstavnyRelatedSlovlexContext, mapUstavnyResolvedIdentity } from "./mapper.js";
export class UstavnyProvider extends PlaceholderProvider {
    #client;
    constructor(client = new UstavnyClient()) {
        super("ustavny");
        this.#client = client;
    }
    async searchDecisions(input) {
        if (input.courtName && !courtNamesMatch(input.courtName, USTAVNY_COURT_NAME)) {
            return {
                total: 0,
                items: [],
                providerBreakdown: { ustavny: 0 },
                dedupApplied: false,
                coverageNotes: [
                    `ustavny covers only ${USTAVNY_COURT_NAME}; the requested courtName ("${input.courtName}") ` +
                        "does not match, so 0 results were returned instead of silently ignoring the filter."
                ]
            };
        }
        const response = await this.#client.searchDecisions(input);
        const items = response.documents.map((item) => mapUstavnyDecisionSummary(item));
        const coverageNotes = [
            "ustavny search uses the official Constitutional Court DMS API behind the public site.",
            "Supported filters in the current provider are query, spisovaZnacka, identifikacneCisloSpisu, ecli, date range, decisionForm, decisionNature, legalArea, legalSubArea, and citedLaw."
        ];
        if (input.courtId || input.courtType) {
            coverageNotes.push("Court id/type filters are ignored because ustavny covers one court only; courtName is honoured " +
                "by exact match against that single court instead.");
        }
        return {
            total: response.numFound,
            items,
            providerBreakdown: {
                ustavny: items.length
            },
            dedupApplied: false,
            coverageNotes
        };
    }
    async getDecisionDetail(input) {
        const response = await this.#client.getDecisionWithContent(input.id);
        return mapUstavnyDecisionDetail({
            item: response.detail,
            textContent: response.textContent,
            textSourceMode: response.textSourceMode,
            contentError: response.contentError
        });
    }
    async autocompleteDecisions(input) {
        const response = await this.#client.searchDecisions({
            provider: "ustavny",
            query: input.query,
            limit: input.limit ?? 10,
            offset: 0,
            view: "compact"
        });
        return {
            items: response.documents.slice(0, input.limit ?? 10).map((item) => {
                const summary = mapUstavnyDecisionSummary(item);
                return {
                    provider: "ustavny",
                    id: summary.providerId,
                    label: summary.spisovaZnacka ?? summary.title ?? summary.providerId,
                    courtName: summary.courtName,
                    decisionForm: summary.decisionForm,
                    ecli: summary.ecli
                };
            })
        };
    }
    async resolveDecisionIdentity(input) {
        if (input.provider !== "auto" && input.provider !== "ustavny") {
            return mapUstavnyResolvedIdentity(null, ["Requested provider is not ustavny."]);
        }
        const id = await this.#client.resolveDecisionIdentity(input);
        if (!id) {
            return mapUstavnyResolvedIdentity(null, ["No matching ustavny decision was found."]);
        }
        try {
            const detail = await this.#client.getDecisionDetail(id);
            return mapUstavnyResolvedIdentity(detail);
        }
        catch {
            return mapUstavnyResolvedIdentity(null, [
                "Resolved ustavny identifier could not be loaded from the source."
            ]);
        }
    }
    async batchGetDecisionSummaries(input) {
        const ids = input.items.filter((item) => item.provider === "ustavny").map((item) => item.id);
        const details = await Promise.all(ids.map((id) => this.#client.getDecisionDetail(id)));
        return details.map((detail) => mapUstavnyDecisionSummary(detail));
    }
    async relatedSlovlexContext(input) {
        const detail = await this.#client.getDecisionDetail(input.id);
        return mapUstavnyRelatedSlovlexContext(detail);
    }
    async downloadDecisionDocument(input) {
        return this.#client.downloadDecisionDocument(input);
    }
    async getDecisionText(input) {
        return this.#client.getDecisionText(input);
    }
    async getProviderHealth() {
        const health = await this.#client.getProviderHealth();
        return buildProviderHealth({
            provider: "ustavny",
            available: health.ok,
            capabilities: getProviderCapabilities("ustavny"),
            coverage: getProviderCoverageProfile("ustavny"),
            notes: health.notes
        });
    }
    async pollRecentDecisions(_input) {
        throw new Error("ustavny does not implement recent polling yet.");
    }
}
//# sourceMappingURL=provider.js.map