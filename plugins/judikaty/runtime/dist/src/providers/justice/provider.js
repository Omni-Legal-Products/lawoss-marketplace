import { PlaceholderProvider } from "../placeholder.js";
import { AmbiguousCourtNameError, CourtFilterMismatchError, CourtNameNotFoundError } from "../../domain/errors.js";
import { resolveJusticeCourtGuid } from "./court-resolver.js";
import { JusticeClient } from "./client.js";
import { buildProviderHealth, getProviderCapabilities, getProviderCoverageProfile } from "../../domain/provider-health.js";
import { normalizeLawReference } from "../../domain/slovlex.js";
import { AMBIGUOUS_REFERENCE_NOTE_PREFIX } from "../../domain/fallback-boundary.js";
import { normalizeCaseRef, stripCourtPrefix } from "../../domain/relation-extractor.js";
import { getDecisionCache } from "../../infra/decision-detail-cache.js";
import { detectJusticePortalFileShape, mapJusticeCourt, mapJusticeDecisionAutocompleteItem, mapJusticeDecisionDetail, mapJusticeDecisionSummary, mapJusticeRelatedSlovlexContext, mapJusticeResolvedIdentity } from "./mapper.js";
/** Candidates fetched when resolving a spisová značka, to detect one number at several courts. */
const SPISOVA_ZNACKA_CANDIDATE_LIMIT = 10;
/** List page searched for the detail guid when confirming the deciding court. */
const DECIDING_COURT_LOOKUP_LIMIT = 20;
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
        return mapJusticeDecisionDetail(response, await this.#identityOverride(response));
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
        if (!input.spisovaZnacka) {
            const searchResult = await this.#client.searchDecisions({
                provider: "justice",
                ecli: input.ecli,
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
        const searchResult = await this.#client.searchDecisions({
            provider: "justice",
            ecli: input.ecli,
            spisovaZnacka: input.spisovaZnacka,
            limit: SPISOVA_ZNACKA_CANDIDATE_LIMIT,
            offset: 0,
            view: "compact"
        });
        const requested = caseRefKey(input.spisovaZnacka);
        const candidates = searchResult.rozhodnutieList.filter((item) => item.spisovaZnacka && caseRefKey(item.spisovaZnacka) === requested);
        const notes = [];
        if (searchResult.numFound > searchResult.rozhodnutieList.length) {
            notes.push(`justice reported ${searchResult.numFound} decisions for this search but only the first ` +
                `${searchResult.rozhodnutieList.length} were checked; further candidates may exist.`);
        }
        const match = candidates[0];
        if (!match) {
            const skipped = searchResult.rozhodnutieList.length;
            return mapJusticeResolvedIdentity(null, [
                "No matching justice decision was found.",
                ...(skipped > 0
                    ? [
                        `justice returned ${skipped} decision(s) whose spisová značka differs from ` +
                            `"${input.spisovaZnacka}"; they were not treated as a match.`
                    ]
                    : []),
                ...notes
            ]);
        }
        const courts = new Set(candidates.map(courtKey));
        if (courts.size > 1) {
            return mapJusticeResolvedIdentity(null, [
                `${AMBIGUOUS_REFERENCE_NOTE_PREFIX} justice has decisions under spisová značka ` +
                    `"${input.spisovaZnacka}" at ${courts.size} different courts, so none was picked. ` +
                    "Pass providerId (the justice guid) or the ECLI of the intended decision.",
                ...candidates.map(describeCandidate),
                ...notes
            ]);
        }
        if (candidates.length > 1) {
            notes.push(`The same court file has ${candidates.length} decisions; the first was returned. Others: ` +
                candidates.slice(1).map(describeCandidate).join(" "));
        }
        const detail = await this.#client.getDecisionDetail({ id: match.guid });
        return mapJusticeResolvedIdentity(detail, notes);
    }
    /**
     * For the portal file shape (detail `spisovaZnacka`/`sud` name the first-instance
     * file), confirm the deciding court from the search list item with the same guid.
     * Returns an empty override for ordinary details, and `decidingCourt: null` when the
     * court cannot be confirmed, so the mapper never falls back to the first-instance court.
     */
    async #identityOverride(detail) {
        const shape = detectJusticePortalFileShape(detail);
        if (!shape) {
            return {};
        }
        // Only confirmed courts are cached, so a failed lookup is retried next time.
        const cache = getDecisionCache("justice", "deciding-court");
        const cached = cache.get(detail.guid);
        if (cached) {
            return { decidingCourt: cached };
        }
        try {
            const response = await this.#client.searchDecisions({
                provider: "justice",
                spisovaZnacka: shape.ownRef,
                limit: DECIDING_COURT_LOOKUP_LIMIT,
                offset: 0,
                view: "compact"
            });
            const item = response.rozhodnutieList.find((candidate) => candidate.guid === detail.guid);
            const name = item?.sud.nazov?.trim();
            if (!item || !name) {
                return { decidingCourt: null };
            }
            const court = { id: item.sud.registreGuid ?? null, name };
            cache.set(detail.guid, court);
            return { decidingCourt: court };
        }
        catch {
            return { decidingCourt: null };
        }
    }
    async batchGetDecisionSummaries(input) {
        const details = await Promise.all(input.items
            .filter((item) => item.provider === "justice")
            .map(async (item) => {
            const detail = await this.#client.getDecisionDetail({ id: item.id });
            return { detail, override: await this.#identityOverride(detail) };
        }));
        return details.map(({ detail, override }) => {
            const mapped = mapJusticeDecisionDetail(detail, override);
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
        return mapJusticeRelatedSlovlexContext(detail, await this.#identityOverride(detail));
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
function caseRefKey(ref) {
    return normalizeCaseRef(stripCourtPrefix(ref) ?? ref);
}
function courtKey(item) {
    return item.sud.registreGuid ?? item.sud.nazov ?? item.guid;
}
function describeCandidate(item) {
    return (`Candidate: ${item.sud.nazov ?? "Neznámy súd"}, ${item.datumVydania ?? "date unknown"}, ` +
        `${item.formaRozhodnutia ?? "form unknown"}, providerId=${item.guid}.`);
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