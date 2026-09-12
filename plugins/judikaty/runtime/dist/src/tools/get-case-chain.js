import * as z from "zod/v4";
import { normalizeCaseRef } from "../domain/relation-extractor.js";
import { getRelationsReviewing, getRelationsBySourceRef, recordRefLookup } from "../providers/nsud/law-index-store.js";
import { asToolResult } from "../server/response.js";
const InputShape = { spisovaZnacka: z.string().min(2).describe("Spisová značka ktoréhokoľvek článku reťaze (OS/KS/NS/ÚS)") };
const MAX_DEPTH = 5;
const MAX_NODES = 60;
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
            edges.push({ fromCourt: r.sourceCourt, fromRef: r.sourceRef, toCourt: r.targetCourt, toRef: r.targetRef, disposition: r.disposition, direction: "up" });
            const next = r.sourceRef ? normalizeCaseRef(r.sourceRef) : null;
            if (next && !visited.has(next)) {
                visited.add(next);
                queue.push({ norm: next, depth: depth + 1 });
            }
        }
        // down: what `norm` itself reviewed (norm is the source side)
        for (const r of await getRelationsBySourceRef(norm)) {
            edges.push({ fromCourt: r.sourceCourt, fromRef: r.sourceRef, toCourt: r.targetCourt, toRef: r.targetRef, disposition: r.disposition, direction: "down" });
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
    return {
        subject: { spisovaZnacka: input.spisovaZnacka, normalizedRef: rootNorm },
        nodes: Array.from(visited),
        edges: unique,
        coverageNote: "Reťaz vychádza z lokálne indexovaných vzťahov — chýbajúci článok znamená, že zatiaľ nie je v indexe, nie že neexistuje."
    };
}
export function registerGetCaseChainTool(server) {
    server.registerTool("get_case_chain", {
        title: "Procesná reťaz veci",
        description: "Celý procesný život veci jedným volaním: OS → KS → NS → ÚS strom zo vzťahového indexu (kto koho preskúmal, s akým výrokom). Lokálny lookup, kompaktný výstup.",
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