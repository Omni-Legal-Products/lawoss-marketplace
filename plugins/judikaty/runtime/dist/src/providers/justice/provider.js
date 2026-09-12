import { PlaceholderProvider } from "../placeholder.js";
import { AmbiguousCourtNameError, CourtFilterMismatchError, CourtNameNotFoundError } from "../../domain/errors.js";
import { resolveJusticeCourtGuid } from "./court-resolver.js";
import { JusticeClient } from "./client.js";
import { buildProviderHealth, getProviderCapabilities, getProviderCoverageProfile } from "../../domain/provider-health.js";
import { normalizeLawReference } from "../../domain/slovlex.js";
import { mapJusticeCourt, mapJusticeDecisionAutocompleteItem, mapJusticeDecisionDetail, mapJusticeDecisionSummary, mapJusticeRelatedSlovlexContext, mapJusticeResolvedIdentity } from "./mapper.js";
export class JusticeProvider extends PlaceholderProvider {
    #client;
    constructor(client = new JusticeClient()) {
        super("justice");
        this.#client = client;
    }
    async searchDecisions(input) {
        const normalized = normalizeJusticeSearchInput(input);
        const coverageNotes = [...normalized.coverageNotes];
        let searchInput = normalized.input;
        if (searchInput.courtName) {
            const resolution = await resolveJusticeCourtGuid(this.#client, searchInput.courtName);
            if (resolution.status === "not_found") {
                throw new CourtNameNotFoundError(searchInput.courtName, resolution.suggestions);
            }
            if (resolution.status === "ambiguous") {
                throw new AmbiguousCourtNameError(searchInput.courtName, resolution.candidates);
            }
            if (searchInput.courtId && searchInput.courtId !== resolution.guid) {
                throw new CourtFilterMismatchError(searchInput.courtName, searchInput.courtId, resolution.guid);
            }
            searchInput = { ...searchInput, courtId: resolution.guid };
            coverageNotes.push(`justice: courtName "${normalized.input.courtName}" was resolved to court ` +
                `"${resolution.matchedName}" (guidSud="${resolution.guid}") and applied as the court filter.`);
        }
        const response = await this.#client.searchDecisions(searchInput);
        const items = response.rozhodnutieList.map(mapJusticeDecisionSummary);
        if (input.provider === "auto") {
            coverageNotes.push("Auto mode currently resolves to justice only.");
        }
        return {
            total: response.numFound,
            items,
            providerBreakdown: {
                justice: items.length
            },
            dedupApplied: false,
            coverageNotes: [
                ...coverageNotes,
                "justice coverage is strongest for cross-court metadata. Full text usually depends on a public PDF.",
                "Lower-court justice lookup is best-effort only. Some publicly visible decisions are not returned by the Ministry search index."
            ]
        };
    }
    async getDecisionDetail(input) {
        const response = await this.#client.getDecisionDetail(input);
        return mapJusticeDecisionDetail(response);
    }
    async searchCourts(input) {
        const suggestions = await this.#client.autocompleteCourts(input);
        const detailItems = await Promise.all(suggestions.map((item) => this.#client.getCourtDetail(item.registreGuid)));
        const normalized = detailItems
            .map(mapJusticeCourt)
            .filter((item) => matchesCourtFilters(item, input))
            .slice(0, input.limit);
        return {
            total: normalized.length,
            items: normalized
        };
    }
    async autocompleteDecisions(input) {
        const items = await this.#client.autocompleteDecisions({
            ...input,
            query: sanitizeJusticeQuery(input.query)
        });
        return {
            items: items.map(mapJusticeDecisionAutocompleteItem)
        };
    }
    async resolveDecisionIdentity(input) {
        if (input.provider !== "auto" && input.provider !== "justice") {
            return mapJusticeResolvedIdentity(null, ["Requested provider is not justice."]);
        }
        if (input.providerId) {
            try {
                const detail = await this.#client.getDecisionDetail({ id: input.providerId });
                return mapJusticeResolvedIdentity(detail);
            }
            catch {
                return mapJusticeResolvedIdentity(null, [
                    "Provided providerId does not match a justice decision."
                ]);
            }
        }
        if (!input.ecli && !input.spisovaZnacka) {
            return mapJusticeResolvedIdentity(null, ["No identity fields were provided."]);
        }
        const searchResult = await this.#client.searchDecisions({
            provider: "justice",
            ecli: input.ecli,
            spisovaZnacka: input.spisovaZnacka,
            limit: 1,
            offset: 0,
            view: "compact"
        });
        const match = searchResult.rozhodnutieList[0];
        if (!match) {
            return mapJusticeResolvedIdentity(null, ["No matching justice decision was found."]);
        }
        const detail = await this.#client.getDecisionDetail({ id: match.guid });
        return mapJusticeResolvedIdentity(detail);
    }
    async batchGetDecisionSummaries(input) {
        const details = await Promise.all(input.items
            .filter((item) => item.provider === "justice")
            .map((item) => this.#client.getDecisionDetail({ id: item.id })));
        return details.map((detail) => {
            const mapped = mapJusticeDecisionDetail(detail);
            return {
                provider: mapped.provider,
                providerId: mapped.providerId,
                ecli: mapped.ecli,
                courtName: mapped.court.name,
                courtId: mapped.court.id,
                courtType: mapped.court.type,
                spisovaZnacka: mapped.spisovaZnacka,
                identifikacneCisloSpisu: mapped.identifikacneCisloSpisu,
                decisionForm: mapped.decisionForm,
                decisionNature: mapped.decisionNature,
                dateIssued: mapped.dateIssued,
                judgeName: mapped.judge.name,
                legalAreas: mapped.legalAreas,
                legalSubAreas: mapped.legalSubAreas,
                title: mapped.spisovaZnacka,
                summary: null,
                documentUrl: mapped.document.url,
                sourceUrl: mapped.source.sourceUrl,
                updatedAt: null,
                retrievedAt: mapped.source.retrievedAt,
                sourceAvailability: mapped.sourceAvailability,
                sourceProvenance: mapped.sourceProvenance,
                sourceCompleteness: mapped.sourceCompleteness,
                availabilityNotes: mapped.availabilityNotes,
                normalizationConfidence: mapped.normalizationConfidence
            };
        });
    }
    async findDecisionsByLaw(input) {
        const response = await this.#client.findDecisionsByLaw(input);
        const items = response.rozhodnutieList.map(mapJusticeDecisionSummary);
        const normalized = normalizeLawReference(input.paragraph ? { law: input.law, paragraph: input.paragraph } : { law: input.law });
        return {
            total: response.numFound,
            items,
            providerBreakdown: {
                justice: items.length
            },
            dedupApplied: false,
            coverageNotes: normalized.notes
        };
    }
    async relatedSlovlexContext(input) {
        const detail = await this.#client.getDecisionDetail(input);
        return mapJusticeRelatedSlovlexContext(detail);
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
            provider: "justice",
            available: health.ok,
            capabilities: getProviderCapabilities("justice"),
            coverage: getProviderCoverageProfile("justice"),
            notes: health.notes
        });
    }
    async pollRecentDecisions(input) {
        return this.searchDecisions({
            provider: "justice",
            limit: input.limit,
            offset: 0,
            view: "compact"
        });
    }
}
function matchesCourtFilters(item, input) {
    if (input.courtType && item.type !== input.courtType) {
        return false;
    }
    if (input.region && item.region !== input.region) {
        return false;
    }
    if (input.district &&
        !item.district?.toLocaleLowerCase().includes(input.district.toLocaleLowerCase())) {
        return false;
    }
    if (input.query &&
        !item.name.toLocaleLowerCase().includes(input.query.toLocaleLowerCase())) {
        return false;
    }
    return true;
}
function normalizeJusticeSearchInput(input) {
    if (!input.query) {
        return {
            input,
            coverageNotes: []
        };
    }
    const sanitizedQuery = sanitizeJusticeQuery(input.query);
    if (sanitizedQuery === input.query) {
        return {
            input,
            coverageNotes: []
        };
    }
    return {
        input: {
            ...input,
            query: sanitizedQuery
        },
        coverageNotes: [
            "justice query syntax does not support boolean operators like AND/OR/NOT. Those tokens were removed before searching."
        ]
    };
}
function sanitizeJusticeQuery(query) {
    return query
        .replace(/\b(?:AND|OR|NOT)\b/giu, " ")
        .replace(/\s+/g, " ")
        .trim();
}
//# sourceMappingURL=provider.js.map