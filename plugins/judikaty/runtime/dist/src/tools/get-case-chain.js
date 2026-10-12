import * as z from "zod/v4";
import { normalizeCaseRef } from "../domain/relation-extractor.js";
import { pickModelOverlay } from "../domain/relation-model-labels.js";
import { getRelationsReviewing, getRelationsBySourceRef, recordRefLookup } from "../providers/nsud/law-index-store.js";
import { asToolResult } from "../server/response.js";
import { ambiguityNoteFor, REF_ONLY_MATCHING_NOTE } from "./get-decision-treatment.js";
import { isTextEstimate } from "./search-decisions/treatment-flags.js";
const InputShape = { spisovaZnacka: z.string().min(2).describe("Spisová značka ktoréhokoľvek článku reťaze (OS/KS/NS/ÚS)") };
const MAX_DEPTH = 5;
const MAX_NODES = 60;
const textEstimateField = (row) => (isTextEstimate(row) ? { textEstimate: true } : {});
/**
 * Nodes are file numbers without a court, so one node can merge different files (the
 * same number at several courts) and the walk then continues into the wrong chain.
 * One sentence per node whose edges show that.
 */
function chainAmbiguityNote(edges) {
    const byNode = new Map();
    const entry = (ref) => {
        const norm = normalizeCaseRef(ref);
        const existing = byNode.get(norm) ?? { ref, courts: [], reviewers: [] };
        byNode.set(norm, existing);
        return existing;
    };
    for (const edge of edges) {
        if (edge.fromRef)
            entry(edge.fromRef).courts.push(edge.fromCourt);
        const target = entry(edge.toRef);
        target.courts.push(edge.toCourt);
        target.reviewers.push(edge.fromCourt);
    }
    const notes = [...byNode.values()]
        .map((node) => ambiguityNoteFor(node.ref, node.courts, node.reviewers))
        .filter((note) => note !== null);
    return notes.length > 0 ? notes.join(" ") : null;
}
export async function buildCaseChain(input) {
    const rootNorm = normalizeCaseRef(input.spisovaZnacka);
    const visited = new Set([rootNorm]);
    const edges = [];
    const queue = [{ norm: rootNorm, depth: 0 }];
    while (queue.length > 0 && visited.size < MAX_NODES) {
        const { norm, depth } = queue.shift();
        if (depth >= MAX_DEPTH)
            continue;
        // up: who reviewed `norm` (norm is the target side)
        for (const r of await getRelationsReviewing(norm)) {
            edges.push({ fromCourt: r.sourceCourt, fromRef: r.sourceRef, toCourt: r.targetCourt, toRef: r.targetRef, disposition: r.disposition, direction: "up", ...textEstimateField(r), ...pickModelOverlay(r) });
            const next = r.sourceRef ? normalizeCaseRef(r.sourceRef) : null;
            if (next && !visited.has(next)) {
                visited.add(next);
                queue.push({ norm: next, depth: depth + 1 });
            }
        }
        // down: what `norm` itself reviewed (norm is the source side)
        for (const r of await getRelationsBySourceRef(norm)) {
            edges.push({ fromCourt: r.sourceCourt, fromRef: r.sourceRef, toCourt: r.targetCourt, toRef: r.targetRef, disposition: r.disposition, direction: "down", ...textEstimateField(r), ...pickModelOverlay(r) });
            const next = normalizeCaseRef(r.targetRef);
            if (next && !visited.has(next)) {
                visited.add(next);
                queue.push({ norm: next, depth: depth + 1 });
            }
        }
    }
    // dedupe edges (same from/to/disposition can be discovered from both ends)
    const seen = new Set();
    const unique = edges.filter((e) => { const k = `${e.fromRef}|${e.toRef}|${e.disposition}`; if (seen.has(k))
        return false; seen.add(k); return true; });
    const ambiguityNote = chainAmbiguityNote(unique);
    return {
        subject: { spisovaZnacka: input.spisovaZnacka, normalizedRef: rootNorm },
        nodes: Array.from(visited),
        edges: unique,
        coverageNote: "Reťaz vychádza z lokálne indexovaných vzťahov — chýbajúci článok znamená, že zatiaľ nie je v indexe, nie že neexistuje. " +
            "Výroky z textu rozhodnutí (textEstimate) sú odhady, over ich v rozhodnutí. " +
            REF_ONLY_MATCHING_NOTE,
        ...(ambiguityNote ? { ambiguityNote } : {})
    };
}
export function registerGetCaseChainTool(server) {
    server.registerTool("get_case_chain", {
        title: "Procesná reťaz veci",
        description: "Celý procesný život veci jedným volaním: OS → KS → NS → ÚS strom zo vzťahového indexu (kto koho preskúmal, s akým výrokom). Lokálny lookup, kompaktný výstup. Výroky vyčítané z textu sú odhady a väzby sa párujú len podľa spisovej značky bez súdu.",
        inputSchema: InputShape
    }, async (input) => {
        const parsed = z.object(InputShape).parse(input);
        // Same signal as get_decision_treatment: asking for a case's procedural life
        // means the user cares about it, so it joins the implicit watchlist.
        await recordRefLookup(parsed.spisovaZnacka);
        return asToolResult(await buildCaseChain(parsed));
    });
}
//# sourceMappingURL=get-case-chain.js.map