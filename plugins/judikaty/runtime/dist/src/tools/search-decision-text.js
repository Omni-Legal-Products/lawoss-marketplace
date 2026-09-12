import { looseNumber } from "./scalars.js";
import * as z from "zod/v4";
import { countNsudDecisionTexts, countProviderTexts, getDecisionAbstracts, getDecisionTextHeaders, getProviderRecords, searchDecisionAbstractsFts, searchNsudDecisionTextFts, searchProviderTextsFts } from "../providers/nsud/law-index-store.js";
import { resolveDecisionIdentities } from "../domain/decision-identity.js";
import { asToolResult } from "../server/response.js";
import { buildTreatmentFlags } from "./search-decisions/treatment-flags.js";
const PROVIDERS = ["nsud", "ustavny", "justice"];
const InputShape = {
    query: z.string().min(2).describe("Free-text query. Tokens prefix-match by default to deal with Slovak inflection; wrap in double quotes for an exact phrase."),
    limit: looseNumber(z.number().int().min(1).max(50)).default(10),
    offset: looseNumber(z.number().int().min(0)).default(0),
    snippetCharsAround: looseNumber(z.number().int().min(4).max(32))
        .default(12)
        .describe("How many tokens of context to include on each side of the match in the snippet."),
    providers: z
        .array(z.enum(PROVIDERS))
        .optional()
        .describe("Optional filter to restrict the search to a subset of local corpora (nsud, ustavny, justice).")
};
export function registerSearchDecisionTextTool(server) {
    server.registerTool("search_decision_text", {
        title: "Search Decision Text (local FTS5)",
        description: "Full-text search proti lokálne indexovanému korpusu (bm25 ranking, snippet generation, diacritics-insensitive, prefix-matching). Lokálny fulltext korpus NS + ÚS + justice (justice priebežne rastie); voliteľný filter providers. Pre naviac zdrojov mimo lokálneho korpusu použite search_decisions.",
        inputSchema: InputShape
    }, async (input) => {
        const parsed = z.object(InputShape).parse(input);
        const providersFilter = parsed.providers;
        const includeNsud = !providersFilter || providersFilter.includes("nsud");
        const otherProviders = providersFilter
            ? providersFilter.filter((p) => p !== "nsud")
            : ["ustavny", "justice"];
        const [nsudHits, otherHits, abstractHits, corpusNsud, corpusUstavny, corpusJustice] = await Promise.all([
            includeNsud
                ? searchNsudDecisionTextFts({
                    query: parsed.query,
                    limit: parsed.limit * 2,
                    offset: parsed.offset,
                    snippetCharsAround: parsed.snippetCharsAround
                })
                : Promise.resolve([]),
            otherProviders.length > 0
                ? searchProviderTextsFts({
                    query: parsed.query,
                    limit: parsed.limit * 2,
                    offset: parsed.offset,
                    snippetCharsAround: parsed.snippetCharsAround,
                    providers: otherProviders
                })
                : Promise.resolve([]),
            searchDecisionAbstractsFts({
                query: parsed.query,
                limit: parsed.limit * 2,
                offset: parsed.offset,
                // Without this a request for one provider came back with another provider's
                // decisions, because the abstract index covers all three.
                ...(providersFilter ? { providers: providersFilter } : {})
            }),
            countNsudDecisionTexts(),
            countProviderTexts("ustavny"),
            countProviderTexts("justice")
        ]);
        // One query rather than one per hit: the store is synchronous, so a
        // per-hit await would run up to `limit` queries on the request thread.
        const records = await getProviderRecords(otherHits.map((hit) => ({ provider: hit.provider, id: hit.id })));
        const enrichedOtherHits = otherHits.map((hit) => {
            const record = records.get(`${hit.provider}:${hit.id}`);
            return {
                provider: hit.provider,
                providerId: hit.id,
                ecli: null,
                spisovaZnacka: record?.spisovaZnacka ?? null,
                dateIssued: record?.dateIssued ?? null,
                snippet: hit.snippet,
                rank: hit.rank
            };
        });
        const nsudHitRows = nsudHits.map((hit) => ({
            provider: "nsud",
            providerId: hit.id,
            ecli: hit.ecli,
            spisovaZnacka: hit.spisovaZnacka,
            dateIssued: hit.dateIssued,
            snippet: hit.snippet,
            rank: hit.rank
        }));
        // Keep more than asked for until after duplicates are collapsed: the portal's
        // twin copies of a judgment both match, so slicing to `limit` first meant a
        // request for 4 hits came back with 2.
        const merged = [...nsudHitRows, ...enrichedOtherHits]
            .sort((a, b) => a.rank - b.rank)
            .slice(0, parsed.limit * 2);
        // Abstracts are searched alongside the full texts, and a decision found in both
        // keeps its better (abstract) rank: the abstract is dense legal text, so a match
        // there means the query hit the operative part or the framing of the legal
        // question rather than a passing mention somewhere in twenty pages.
        const byKey = new Map(merged.map((hit) => [`${hit.provider}:${hit.providerId}`, hit]));
        for (const abstractHit of abstractHits) {
            const key = `${abstractHit.provider}:${abstractHit.id}`;
            const existing = byKey.get(key);
            if (existing) {
                existing.rank = Math.min(existing.rank, abstractHit.rank);
                existing.matchedIn = "abstract+text";
                continue;
            }
            // Found only via its abstract — carry the identity we have and let the
            // resolution step below fill in the reference.
            byKey.set(key, {
                provider: abstractHit.provider,
                providerId: abstractHit.id,
                ecli: null,
                spisovaZnacka: null,
                dateIssued: null,
                snippet: "",
                rank: abstractHit.rank,
                matchedIn: "abstract"
            });
        }
        const combined = [...byKey.values()].sort((a, b) => a.rank - b.rank);
        // Validate references, recover the ones the portal never had from the text
        // header, and collapse the portal's duplicate copies. Shared with
        // search_decisions so the two tools cannot disagree about identity.
        const { items: deduped, duplicatesSuppressed } = await resolveDecisionIdentities(combined, getDecisionTextHeaders);
        // Phase 1 of two-phase reading: every hit says whether it is still good law,
        // so deciding what to read costs no extra calls. Batched into one query —
        // per-hit lookups would put N synchronous queries on the request thread.
        const paged = deduped.slice(0, parsed.limit);
        const [flags, abstracts] = await Promise.all([
            buildTreatmentFlags(paged.map((hit) => hit.spisovaZnacka)),
            getDecisionAbstracts(paged.map((hit) => ({ provider: hit.provider, id: hit.providerId })))
        ]);
        const hits = paged.map((hit) => {
            const flag = hit.spisovaZnacka ? flags.get(hit.spisovaZnacka.trim()) : undefined;
            const abstract = abstracts.get(`${hit.provider}:${hit.providerId}`);
            return {
                ...hit,
                matchedIn: hit.matchedIn ?? "text",
                ...(abstract?.vyrok ? { vyrok: abstract.vyrok } : {}),
                ...(abstract?.lead ? { lead: abstract.lead } : {}),
                ...(abstract?.holding ? { holding: abstract.holding } : {}),
                ...(flag ? { treatment: flag } : {})
            };
        });
        return asToolResult({
            corpusSize: {
                nsud: corpusNsud,
                ustavny: corpusUstavny,
                justice: corpusJustice
            },
            corpusSizeTotal: corpusNsud + corpusUstavny + corpusJustice,
            query: parsed.query,
            ...(duplicatesSuppressed > 0 ? { duplicatesSuppressed } : {}),
            hits,
            readFullText: "export_decision_markdown({provider, id}) vráti KOMPLETNÉ rozhodnutie (provider a id sú v každom zásahu). Snippet nižšie je len ukážka zhody — nikdy z neho necituj.",
            notes: [
                "vyrok = čo súd rozhodol, lead = úvod odôvodnenia (o čom vec bola). Snippet ukazuje, kde sa trafil dotaz. Snippets use [[ ]] to highlight matched terms.",
                "matchedIn: abstract = dotaz sa trafil do výroku/odôvodnenia (silnejší signál), text = len niekde v plnom texte.",
                "treatment.kind=review = vyšší súd naozaj rozhodol o tomto rozhodnutí. kind=mention = iné rozhodnutie ho len spomína, o osude nevieme nič. Chýbajúce treatment znamená 'nič nevieme', NIE 'je to platné'.",
                "Only decisions whose text has been indexed locally are returned. Use get_provider_health or get_nsud_index_stats to inspect coverage.",
                "spisovaZnackaSource='derived-from-text' znamená, že značku portál neuvádza a bola prečítaná z hlavičky rozsudku — pred citovaním ju over v plnom texte.",
                "spisovaZnacka for ÚS/justice hits is enriched from the local provider_records mirror and may be null if not yet backfilled."
            ]
        });
    });
}
//# sourceMappingURL=search-decision-text.js.map