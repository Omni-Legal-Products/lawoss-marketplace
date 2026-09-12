import { ProviderUnavailableError } from "../domain/errors.js";
import { buildProviderHealth, getProviderCoverageProfile } from "../domain/provider-health.js";
export class PlaceholderProvider {
    id;
    constructor(id) {
        this.id = id;
    }
    async searchDecisions(_input) {
        throw new ProviderUnavailableError(this.id, "searchDecisions is not implemented yet.");
    }
    async getDecisionDetail(_input) {
        throw new ProviderUnavailableError(this.id, "getDecisionDetail is not implemented yet.");
    }
    async searchCourts(_input) {
        throw new ProviderUnavailableError(this.id, "searchCourts is not implemented yet.");
    }
    async resolveDecisionIdentity(_input) {
        throw new ProviderUnavailableError(this.id, "resolveDecisionIdentity is not implemented yet.");
    }
    async batchGetDecisionSummaries(_input) {
        throw new ProviderUnavailableError(this.id, "batchGetDecisionSummaries is not implemented yet.");
    }
    async findDecisionsByLaw(_input) {
        throw new ProviderUnavailableError(this.id, "findDecisionsByLaw is not implemented yet.");
    }
    async relatedSlovlexContext(_input) {
        throw new ProviderUnavailableError(this.id, "relatedSlovlexContext is not implemented yet.");
    }
    async downloadDecisionDocument(_input) {
        throw new ProviderUnavailableError(this.id, "downloadDecisionDocument is not implemented yet.");
    }
    async getDecisionText(_input) {
        throw new ProviderUnavailableError(this.id, "getDecisionText is not implemented yet.");
    }
    async getProviderHealth() {
        return buildProviderHealth({
            provider: this.id,
            available: false,
            capabilities: {
                search: false,
                detail: false,
                text: false,
                document: false,
                lawSearch: false,
                slovlexContext: false,
                recentPolling: false,
                courtSearch: false,
                identityResolution: false,
                autocomplete: false
            },
            coverage: getProviderCoverageProfile(this.id),
            notes: ["Provider scaffold exists, but implementation is pending."]
        });
    }
    async pollRecentDecisions(_input) {
        throw new ProviderUnavailableError(this.id, "pollRecentDecisions is not implemented yet.");
    }
}
export function placeholderHealthResult(items) {
    return { items };
}
//# sourceMappingURL=placeholder.js.map