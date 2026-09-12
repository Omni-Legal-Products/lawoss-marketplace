import { ZodError } from "zod/v4";
import { PlaceholderProvider } from "../placeholder.js";
import { DecisionNotFoundError } from "../../domain/errors.js";
import { courtNamesMatch } from "../../domain/court-name-match.js";
import { applyDateRangeGuard } from "../../domain/merge.js";
import { NsudClient } from "./client.js";
import { buildProviderHealth, getProviderCapabilities, getProviderCoverageProfile } from "../../domain/provider-health.js";
import { NSUD_COURT_NAME, mapNsudDecisionDetail, mapNsudDecisionSummary, mapNsudRelatedSlovlexContext, mapNsudResolvedIdentity } from "./mapper.js";
import { buildNsudCitationCandidateQueries, buildNsudCitationCandidateQueryPlan, extractNsudCitedRegulations } from "./citations.js";
import { countNsudLawIndexByToken, searchNsudLawIndexByToken } from "./law-index-store.js";
/** How many verified ids a false-zero note names before it switches to a count. */
const VERIFIED_IDS_SHOWN = 5;
export class NsudProvider extends PlaceholderProvider {
    #client;
    constructor(client = new NsudClient()) {
        super("nsud");
        this.#client = client;
    }
    async searchDecisions(input) {
        if (input.courtName && !courtNamesMatch(input.courtName, NSUD_COURT_NAME)) {
            return {
                total: 0,
                items: [],
                providerBreakdown: { nsud: 0 },
                dedupApplied: false,
                coverageNotes: [
                    `nsud covers only ${NSUD_COURT_NAME}; the requested courtName ("${input.courtName}") does ` +
                        "not match, so 0 results were returned instead of silently ignoring the filter."
                ]
            };
        }
        const allIds = await this.#client.searchDecisionIds(input);
        const pageIds = allIds.slice(input.offset, input.offset + input.limit);
        const details = await Promise.all(pageIds.map((id) => this.#client.getDecisionDetail(id)));
        const items = details.map((detail, index) => mapNsudDecisionSummary(pageIds[index], detail));
        return {
            total: allIds.length,
            items,
            providerBreakdown: {
                nsud: items.length
            },
            dedupApplied: false,
            coverageNotes: [
                "NS SR search is two-step: searchDecision IDs followed by getDecision detail fetches.",
                "nsud coverage is strongest for Najvyšší súd SR decisions and often includes inline text.",
                ...detectNsudSearchParamCollisions(input),
                ...detectNsudFulltextCorpusGap(input),
                ...(await this.#verifyEmptyTextFilteredResult(input, allIds.length)),
                ...detectNsudDecisionFormUnavailable(input)
            ]
        };
    }
    /**
     * A `spisovaZnacka`+`citedLaw` search that returns 0 is ambiguous: either
     * the reference does not exist, or it exists but is absent from the
     * portal's free-text corpus so `art_obsah` can never match it (see
     * `detectNsudFulltextCorpusGap` for the measurement). Only the second case
     * is a false zero, and the two are indistinguishable from the response --
     * so resolve it by actually asking, with one extra upstream call made
     * ONLY on the empty+both-filters path, and report what came back.
     *
     * This deliberately does NOT fold the recovered decisions into `items`.
     * The caller asked for a text-filtered result and that filter genuinely
     * cannot be evaluated here; returning the hit anyway would answer a
     * question nobody asked. Naming the decision in a note keeps the filter
     * honest while still telling an advocate the reference is real -- the
     * one thing a bare `total: 0` gets actively wrong.
     *
     * A retry that itself fails must stay silent rather than assert anything:
     * an upstream error is not evidence either way, and this whole method
     * exists to stop unverified claims about absence.
     */
    async #verifyEmptyTextFilteredResult(input, resultCount) {
        if (resultCount > 0 || !input.spisovaZnacka || !input.citedLaw) {
            return [];
        }
        const { citedLaw: _droppedForVerification, ...withoutCitedLaw } = input;
        let verifiedIds;
        try {
            verifiedIds = await this.#client.searchDecisionIds(withoutCitedLaw);
        }
        catch {
            return [];
        }
        if (verifiedIds.length === 0) {
            return [
                `nsud: verified just now by a retry without citedLaw -- spisovaZnacka ("${input.spisovaZnacka}") ` +
                    "returns 0 on its own too, so this empty result is not caused by the free-text corpus gap."
            ];
        }
        // `nazov` is a substring match, so a short spisovaZnacka can resolve to
        // a long list -- name a few and say how many, never dump the whole set
        // into a coverage note.
        const shown = verifiedIds.slice(0, VERIFIED_IDS_SHOWN);
        const idList = verifiedIds.length > shown.length
            ? `${shown.join(", ")} (+${verifiedIds.length - shown.length} more)`
            : shown.join(", ");
        return [
            `nsud: this 0 is a FALSE zero for the spisovaZnacka filter. A retry without citedLaw, run just now, ` +
                `resolved spisovaZnacka ("${input.spisovaZnacka}") to ${verifiedIds.length} decision id(s): ` +
                `${idList}. The decision exists; citedLaw ("${input.citedLaw}") could not be ` +
                "evaluated against it because the portal's free-text index does not contain that decision. Call " +
                "again without citedLaw to retrieve it, and verify the citation against the decision text yourself."
        ];
    }
    /**
     * The NS portal answers a nonexistent id with a bare `[]` on a 200, which
     * fails `NsudDecisionDetailSchema`'s object parse. That ZodError is
     * load-bearing one layer down -- `client.ts#getDecisionFetchOutcome` reads
     * exactly this error to classify an id as "absent" during the indexer's
     * high-water-mark walk -- so it must keep escaping the client untouched.
     * It just must not reach a caller: gaps in the NS id space are large and
     * ordinary (222 000-233 000 is nearly empty), so asking for one is a
     * routine not-found, and answering it with a raw schema-validation dump
     * both misreports the cause and reads as a broken server.
     */
    async getDecisionDetail(input) {
        let detail;
        try {
            detail = await this.#client.getDecisionDetail(input.id);
        }
        catch (error) {
            if (error instanceof ZodError) {
                throw new DecisionNotFoundError(input.id);
            }
            throw error;
        }
        return this.#augmentDetailWithCitations(input.id, detail);
    }
    async autocompleteDecisions(input) {
        const ids = await this.#client.searchDecisionIds({
            provider: "nsud",
            spisovaZnacka: input.query,
            limit: input.limit ?? 10,
            offset: 0,
            view: "compact"
        });
        const pageIds = ids.slice(0, input.limit ?? 10);
        const details = await Promise.all(pageIds.map((id) => this.#client.getDecisionDetail(id)));
        return {
            items: details.map((detail, index) => {
                const summary = mapNsudDecisionSummary(pageIds[index], detail);
                return {
                    provider: "nsud",
                    id: summary.providerId,
                    label: summary.spisovaZnacka ?? summary.providerId,
                    courtName: summary.courtName,
                    decisionForm: summary.decisionForm,
                    ecli: summary.ecli
                };
            })
        };
    }
    async resolveDecisionIdentity(input) {
        if (input.provider !== "auto" && input.provider !== "nsud") {
            return mapNsudResolvedIdentity(null, null, ["Requested provider is not nsud."]);
        }
        const id = await this.#client.resolveDecisionIdentity(input);
        if (!id) {
            return mapNsudResolvedIdentity(null, null, ["No matching nsud decision was found."]);
        }
        try {
            const detail = await this.#client.getDecisionDetail(id);
            return mapNsudResolvedIdentity(id, detail);
        }
        catch {
            return mapNsudResolvedIdentity(null, null, [
                "Provided providerId does not match an nsud decision."
            ]);
        }
    }
    async batchGetDecisionSummaries(input) {
        const pageIds = input.items.filter((item) => item.provider === "nsud").map((item) => item.id);
        const details = await Promise.all(pageIds.map((id) => this.#client.getDecisionDetail(id)));
        return details.map((detail, index) => mapNsudDecisionSummary(pageIds[index], detail));
    }
    async findDecisionsByLaw(input) {
        const targetSearchToken = normalizeTargetSearchToken(input);
        const indexedCount = targetSearchToken ? await countNsudLawIndexByToken(targetSearchToken) : 0;
        if (targetSearchToken && indexedCount > 0) {
            const indexedIds = await searchNsudLawIndexByToken({
                searchToken: targetSearchToken,
                offset: input.offset,
                limit: input.limit
            });
            const details = await Promise.all(indexedIds.map((id) => this.#client.getDecisionDetail(id)));
            const items = details.map((detail, index) => mapNsudDecisionSummary(indexedIds[index], detail));
            return {
                total: indexedCount,
                items,
                providerBreakdown: {
                    nsud: items.length
                },
                dedupApplied: false,
                coverageNotes: [
                    "nsud law search used the persisted NS SR citation index built from extracted decision text.",
                    "Extracted citations are normalized to Slov-Lex anchors and cached per decision for subsequent lookups."
                ]
            };
        }
        const candidateQueries = buildNsudCitationCandidateQueries({
            law: input.law,
            ...(input.paragraph ? { paragraph: input.paragraph } : {})
        });
        const candidatePlan = buildNsudCitationCandidateQueryPlan({
            law: input.law,
            ...(input.paragraph ? { paragraph: input.paragraph } : {})
        });
        const candidateIds = await this.#collectCandidateIds(candidatePlan);
        const matched = await this.#filterCandidatesByCitations(candidateIds, targetSearchToken);
        const paged = matched.slice(input.offset, input.offset + input.limit);
        return {
            total: matched.length,
            items: paged.map(({ summary }) => summary),
            providerBreakdown: {
                nsud: paged.length
            },
            dedupApplied: false,
            coverageNotes: [
                "nsud law search uses on-demand citation extraction over extracted decision text rather than merito-only summary matching.",
                "Extracted citations are normalized to Slov-Lex anchors and cached per decision for subsequent lookups.",
                `nsud citation-index candidate queries: ${candidateQueries.join(" | ")}`
            ]
        };
    }
    async relatedSlovlexContext(input) {
        const detail = await this.#client.getDecisionDetail(input.id);
        const resolvedText = await this.#client.resolveDecisionText(input.id, detail, {
            allowUnavailable: true
        });
        const citedRegulations = await extractNsudCitedRegulations({
            id: input.id,
            text: resolvedText.text
        });
        return {
            ...mapNsudRelatedSlovlexContext(input.id, detail),
            citedRegulations
        };
    }
    async downloadDecisionDocument(input) {
        return this.#client.downloadDecisionDocument(input);
    }
    async getDecisionText(input) {
        return this.#client.getDecisionTextWindow(input);
    }
    async getProviderHealth() {
        const health = await this.#client.getProviderHealth();
        return buildProviderHealth({
            provider: "nsud",
            available: health.ok,
            capabilities: getProviderCapabilities("nsud"),
            coverage: getProviderCoverageProfile("nsud"),
            notes: health.notes
        });
    }
    async pollRecentDecisions(input) {
        const ids = await this.#client.getLastDecisionIds(input);
        const pageIds = ids.slice(0, input.limit);
        const details = await Promise.all(pageIds.map((id) => this.#client.getDecisionDetail(id)));
        const items = details.map((detail, index) => mapNsudDecisionSummary(pageIds[index], detail));
        const rawResult = {
            total: ids.length,
            items,
            providerBreakdown: {
                nsud: items.length
            },
            dedupApplied: false,
            coverageNotes: []
        };
        // Same bug class as search_decisions: nothing here previously verified
        // that getLastDecisionIds actually honored sinceDate before returning
        // it as "recent". sinceDate maps directly onto the guard's dateFrom
        // (poll has no upper bound), reusing the same local verification.
        return input.sinceDate
            ? applyDateRangeGuard(rawResult, { dateFrom: input.sinceDate }, "nsud")
            : rawResult;
    }
    async #augmentDetailWithCitations(id, detail) {
        const mapped = mapNsudDecisionDetail(id, detail);
        const resolvedText = await this.#client.resolveDecisionText(id, detail, {
            allowUnavailable: true
        });
        const citedRegulations = await extractNsudCitedRegulations({
            id,
            text: resolvedText.text
        });
        return {
            ...mapped,
            citedRegulations
        };
    }
    async #collectCandidateIds(plan) {
        const totalBudget = 160;
        const [paragraphResults, combinedResults, lawResults] = await Promise.all([
            this.#runCandidateQueries(plan.paragraphQueries),
            this.#runCandidateQueries(plan.combinedQueries),
            this.#runCandidateQueries(plan.lawQueries)
        ]);
        const paragraphIds = paragraphResults.flatMap((result) => result.ids);
        const lawIds = lawResults.flatMap((result) => result.ids);
        const combinedIds = combinedResults.flatMap((result) => result.ids);
        const paragraphSet = new Set(paragraphIds);
        const lawSet = new Set(lawIds);
        const intersectionIds = paragraphIds.filter((id) => lawSet.has(id));
        const prioritized = [
            ...combinedIds,
            ...intersectionIds,
            ...lawIds,
            ...paragraphIds
        ];
        const seen = new Set();
        for (const id of prioritized) {
            if (seen.has(id)) {
                continue;
            }
            seen.add(id);
            if (seen.size >= totalBudget) {
                break;
            }
        }
        return Array.from(seen);
    }
    async #filterCandidatesByCitations(candidateIds, targetSearchToken) {
        if (!targetSearchToken) {
            return [];
        }
        const matched = [];
        for (const chunk of chunkArray(candidateIds, 8)) {
            const resolved = await Promise.all(chunk.map(async (id) => {
                const detail = await this.#client.getDecisionDetail(id);
                const resolvedText = await this.#client.resolveDecisionText(id, detail, {
                    allowUnavailable: true
                });
                const citedRegulations = await extractNsudCitedRegulations({
                    id,
                    text: resolvedText.text
                });
                const searchTokens = citedRegulations
                    .map((item) => item.slovLexLawId && item.slovLexAnchor
                    ? `${item.slovLexLawId}/#${item.slovLexAnchor}`
                    : null)
                    .filter((item) => Boolean(item));
                if (!searchTokens.includes(targetSearchToken)) {
                    return null;
                }
                return {
                    summary: mapNsudDecisionSummary(id, detail),
                    searchToken: searchTokens
                };
            }));
            for (const item of resolved) {
                if (item) {
                    matched.push(item);
                }
            }
        }
        return matched;
    }
    async #runCandidateQueries(queries) {
        return Promise.all(queries.map(async (query) => ({
            query,
            ids: await this.#client.searchDecisionIds({
                provider: "nsud",
                query,
                limit: 200,
                offset: 0,
                view: "compact"
            })
        })));
    }
}
function chunkArray(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}
/**
 * `nsud/client.ts#searchDecisionIds` maps `SearchDecisionsInput` fields onto
 * a smaller set of upstream URL params (`nazov`, `art_obsah`) than the
 * fields that can target them, so certain field COMBINATIONS silently
 * clobber each other, even though `query`/`spisovaZnacka`/`citedLaw` are
 * each individually declared honoured in `domain/search-filter-capabilities.ts`
 * (correctly -- each is genuinely honoured *in isolation*). This detects the
 * `query`-vs-`art_obsah` collisions the client's own control flow actually
 * produces and turns each into a coverageNotes entry naming exactly which
 * field lost, mirroring the courtName-mismatch note above: a filter that
 * silently didn't apply must never look like something it did.
 *
 * `decisionForm` plays NO part in this any more. As of this fix, client.ts
 * never writes it to any upstream parameter at all -- it previously was
 * redirected into `art_merito` (a free-text merit-summary search, not a
 * decision-type filter), which could silently DELETE genuine results
 * instead of harmlessly no-op'ing; that mapping has been removed (see the
 * removal note at the `art_merito` call site in client.ts).
 * `detectNsudDecisionFormUnavailable` below is the single, always-fires-
 * when-requested source of truth for decisionForm's fate; this function no
 * longer needs to say anything about it.
 *
 * This function ALSO reports a third case that is genuinely NOT a collision
 * in the clobbering sense -- `spisovaZnacka` and `citedLaw` both apply at
 * once, to different upstream params (`nazov` and `art_obsah`), and both
 * stay correctly declared `true` in search-filter-capabilities.ts. But live
 * verification found that specific combination can still zero out a real
 * spisovaZnacka match (see case 3 below), so it gets its own reliability
 * caveat -- distinct wording from the "not applied" collision notes, since
 * nothing here was actually dropped.
 *
 * Mirrors client.ts's real branching as of this commit (client.ts is owned
 * by a different agent; if its param-building logic changes, this function
 * must be re-derived from it in the same change, or these notes rot into
 * exactly the kind of false claim this function exists to prevent):
 *
 *  1. `spisovaZnacka` always wins the `nazov`/`art_obsah` slot over `query`
 *     (that branch is an `else if`) -- independent of citedLaw. `query` is
 *     genuinely dropped here: it reaches no upstream parameter at all in
 *     this case, so it has no effect on the result regardless of what else
 *     is present.
 *  2. When `spisovaZnacka` is ABSENT, `citedLaw` overwrites `query` in
 *     `art_obsah` (both target the same param) when both are given.
 *  3. When `spisovaZnacka` AND `citedLaw` are BOTH present (with or without
 *     `query`, which per (1) never reaches `art_obsah` once `spisovaZnacka`
 *     is set), `nazov` and `art_obsah` are both set and both genuinely
 *     applied -- not a collision, and not a filter that silently didn't
 *     apply either. The cause of the zeroing this combination can produce
 *     was measured on 2026-08-17 and is NOT specific to the combination at
 *     all: it is the portal's free-text corpus omitting recently published
 *     decisions, so `art_obsah` cannot match them under any query shape.
 *     `detectNsudFulltextCorpusGap` below owns that finding and states it
 *     for every text-filtered nsud search; the note here stays only to
 *     tell a caller who hit the ambiguous `spisovaZnacka`+`citedLaw` zero
 *     what to do about it, and `NsudProvider#verifyEmptyTextFilteredResult`
 *     resolves that specific zero by asking upstream instead of guessing.
 */
export function detectNsudSearchParamCollisions(input) {
    const notes = [];
    if (input.spisovaZnacka && input.query) {
        notes.push(`nsud: query ("${input.query}") was NOT applied -- spisovaZnacka takes precedence over query for ` +
            "the free-text search (art_obsah) when both are given, so query had no effect on this result.");
    }
    else if (input.query && input.citedLaw) {
        notes.push(`nsud: query ("${input.query}") was NOT applied -- citedLaw overwrites query (both target the ` +
            "same upstream search field, art_obsah) when both are given.");
    }
    if (input.spisovaZnacka && input.citedLaw) {
        notes.push(`nsud: spisovaZnacka ("${input.spisovaZnacka}") and citedLaw ("${input.citedLaw}") were both genuinely ` +
            "applied together (nazov and art_obsah respectively) -- not a collision, both filters really ran. A " +
            "total of 0 here still does NOT by itself mean the spisovaZnacka reference does not exist: if the " +
            "decision is missing from the portal's free-text corpus, adding citedLaw zeroes an otherwise-real " +
            "match. This response resolves that ambiguity upstream rather than leaving it to the caller -- see " +
            "the verification note below when the result was empty.");
    }
    return notes;
}
/**
 * `query` and `citedLaw` are both served by the NS SR portal's free-text
 * parameter `art_obsah`, and both are correctly declared honoured in
 * `domain/search-filter-capabilities.ts` -- the portal really does run them.
 * What it runs them against is the problem: its free-text corpus lags
 * publication, so the newest decisions are unreachable by ANY text filter
 * while remaining perfectly reachable by `spisovaZnacka` and serving their
 * full text on request. That asymmetry is invisible in the response, which
 * is exactly why it needs saying out loud -- a corpus that silently omits
 * recent decisions must not look complete, for the same reason a filter
 * that silently didn't apply must not look like it did.
 *
 * Measured 2026-08-17 with rare-token probes (a probe only counts when the
 * token's own total is small; at the portal's 1000-result cap, absence from
 * page one proves nothing):
 *
 *   in corpus:  245028 (2026-01-29), 245400 (2026-02-25), 245620 (2025-12-11)
 *   absent:     245700 (2026-03-19), 245800 (2026-03-24), 246716 (2026-07-01)
 *
 * all six resolvable by spisovaZnacka, all six `text_available`. Whether the
 * cut-off tracks the decision date or the publication order is unresolved --
 * both models fit those samples, since ids and dates roughly co-vary here
 * (245620 shows they do not co-vary perfectly). Discriminating needs a
 * high-id, old-date sample; four attempts found none. The note therefore
 * describes the gap without asserting which axis bounds it, and states the
 * boundary as the dated measurement it is rather than as current fact --
 * the corpus moves as the portal indexes, so nothing here may be treated
 * as a live cut-off or hardcoded into a filter.
 */
export function detectNsudFulltextCorpusGap(input) {
    if (!input.query && !input.citedLaw) {
        return [];
    }
    return [
        "nsud: query/citedLaw are matched by the NS SR portal's free-text index over decision text, and that " +
            "index lags publication -- measured 2026-08-17, decision ids up to 245620 were indexed while 245700 " +
            "and every later sampled id (head 246780) were not, even though all of them resolve by spisovaZnacka " +
            "and expose full text. Recently published NS decisions can therefore be missing from any text-filtered " +
            "nsud result, including find_decisions_by_law, which discovers its candidates through this same index. " +
            "For recent NS decisions, filter by spisovaZnacka or by date range (served from the local index), or " +
            'use provider="justice" with courtName="Najvyšší súd Slovenskej republiky".'
    ];
}
/**
 * `decisionForm` is declared unhonoured for nsud in
 * `search-filter-capabilities.ts` -- as of this fix, `nsud/client.ts#searchDecisionIds`
 * does not forward it to any upstream parameter at all, because the NS SR
 * portal has no decision-type/category filter to send it to. That generic
 * capability declaration already makes `findUnhonouredFilterFields`/
 * `buildUnhonouredFilterCoverageNote` (search-filter-capabilities.ts, wired
 * in via `tools/search-decisions.ts`) emit a "not honoured" note whenever
 * `decisionForm` is requested for nsud -- this function adds the SPECIFIC
 * why (including the mapping this codebase used to have and removed) and
 * the actionable alternative on top of that generic note, unconditionally
 * whenever `decisionForm` is present: even requested completely alone,
 * decisionForm never behaved as its name promises.
 */
export function detectNsudDecisionFormUnavailable(input) {
    if (!input.decisionForm) {
        return [];
    }
    return [
        `nsud: decisionForm ("${input.decisionForm}") was NOT applied as a decision-form/type filter -- the ` +
            "NS SR portal has no such filter, so this codebase does not forward decisionForm to any upstream " +
            "parameter at all. (It previously was sent as art_merito, which looks like a plausible slot but is " +
            "actually a free-text search over the short merit-summary phrase, not a category filter -- " +
            'live-verified: real decision-form words like "Rozsudok"/"Uznesenie" each matched only a small, ' +
            "arbitrary slice of the corpus, impossible counts for an actual form filter, and sending it there " +
            "could silently DELETE genuine results instead of doing nothing -- a real spisovaZnacka match went " +
            "from 1 result to 0 once art_merito was added. That mapping has been removed.) For rozsudky/" +
            'uznesenia-only results, filter client-side, or use provider="justice", which has a genuine ' +
            "decision-form filter (formaRozhodnutiaFacetFilter)."
    ];
}
function normalizeTargetSearchToken(input) {
    const lawMatch = input.law.trim().match(/(\d+)\/(\d{4})/);
    const paragraphMatch = input.paragraph?.trim().match(/§?\s*(\d+[a-z]?)/i);
    if (!lawMatch?.[1] || !lawMatch[2] || !paragraphMatch?.[1]) {
        return null;
    }
    return `/SK/ZZ/${lawMatch[2]}/${lawMatch[1]}/#paragraf-${paragraphMatch[1].toLowerCase()}`;
}
//# sourceMappingURL=provider.js.map