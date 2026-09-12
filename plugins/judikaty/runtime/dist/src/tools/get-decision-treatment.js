import * as z from "zod/v4";
import { getRelationsReviewing, getRelationsBySourceRef, recordRefLookup } from "../providers/nsud/law-index-store.js";
import { normalizeCaseRef } from "../domain/relation-extractor.js";
import { asToolResult } from "../server/response.js";
const InputShape = {
    spisovaZnacka: z
        .string()
        .min(2)
        .describe("Spisová značka rozhodnutia, ktorého osud chceš preveriť (napr. krajského alebo okresného súdu). " +
        "Tolerantné na medzery a oddeľovače: '5 Co 55/2009' = '5Co/55/2009'.")
};
const COVERAGE_NOTE = "Výsledok vychádza z lokálne indexovaného korpusu. Neprítomnosť zásahu vyššieho súdu " +
    "NEZNAMENÁ, že rozhodnutie nebolo preskúmané — len že sa to v indexovaných rozhodnutiach nenašlo.";
const ADVERSE = new Set(["zrusene", "zrusene_vratene", "zmenene"]);
const STANDS = new Set(["odmietnute", "zamietnute"]);
function deriveStatus(reviewedBy) {
    if (reviewedBy.length === 0) {
        return "Bez zisteného zásahu vyššieho súdu v indexovanom korpuse.";
    }
    const adverse = reviewedBy.find((r) => ADVERSE.has(r.disposition));
    if (adverse) {
        const court = adverse.reviewingCourt ?? "vyšší súd";
        return `⚠️ POZOR: rozhodnutie bolo zrušené/zmenené (${court}, ${adverse.reviewingRef ?? "?"}).`;
    }
    if (reviewedBy.some((r) => r.disposition === "potvrdene")) {
        return "Potvrdené vyšším súdom.";
    }
    if (reviewedBy.some((r) => STANDS.has(r.disposition))) {
        return "Vyšší súd nezasiahol (opravný prostriedok/sťažnosť odmietnuté alebo zamietnuté).";
    }
    return "Rozhodnutie spomenuté vyšším súdom — výrok nejednoznačný, over manuálne.";
}
export async function buildDecisionTreatment(input) {
    const normalizedRef = normalizeCaseRef(input.spisovaZnacka);
    const [reviewingRows, forwardRows] = await Promise.all([
        getRelationsReviewing(normalizedRef),
        getRelationsBySourceRef(normalizedRef)
    ]);
    const reviewedBy = reviewingRows.map((row) => ({
        reviewingCourt: row.sourceCourt,
        reviewingRef: row.sourceRef,
        reviewingProvider: row.sourceProvider,
        reviewingId: row.sourceId,
        disposition: row.disposition,
        confidence: row.confidence
    }));
    const reviews = forwardRows.map((row) => ({
        reviewedCourt: row.targetCourt,
        reviewedRef: row.targetRef,
        disposition: row.disposition,
        confidence: row.confidence
    }));
    return {
        subject: { spisovaZnacka: input.spisovaZnacka, normalizedRef },
        status: deriveStatus(reviewedBy),
        reviewedBy,
        reviews,
        coverageNote: COVERAGE_NOTE
    };
}
export function registerGetDecisionTreatmentTool(server) {
    server.registerTool("get_decision_treatment", {
        title: "Decision Treatment (osud rozhodnutia)",
        description: "Zisti, či bolo rozhodnutie preskúmané vyšším súdom (Najvyšší/Ústavný súd) a s akým výrokom " +
            "(zrušené/potvrdené/zmenené/vrátené). Reverzný 'je to ešte dobrá judikatúra?' lookup nad lokálnym " +
            "indexom citácií. Vracia kompaktný štruktúrovaný výsledok, nie plné texty.",
        inputSchema: InputShape
    }, async (input) => {
        const parsed = z.object(InputShape).parse(input);
        // Checking a decision's fate by name says "I am relying on this case" far
        // more clearly than a search hit does. Recorded so the weekly report can
        // warn about these without the user hand-maintaining a watchlist.
        await recordRefLookup(parsed.spisovaZnacka);
        const treatment = await buildDecisionTreatment(parsed);
        return asToolResult(treatment);
    });
}
//# sourceMappingURL=get-decision-treatment.js.map