// src/tools/search-decisions/treatment-flags.ts
import { asCaseRef, normalizeCaseRef } from "../../domain/relation-extractor.js";
import { pickModelOverlay } from "../../domain/relation-model-labels.js";
import { getRelationsReviewing, getRelationsReviewingMany } from "../../providers/nsud/law-index-store.js";
const DISPOSITION_PRIORITY = [
    "zrusene_vratene",
    "zrusene",
    "zmenene",
    "ciastocne",
    "porusenie_prava",
    "potvrdene",
    "zastavene",
    "odmietnute",
    "zamietnute",
    "ine"
];
const DISPOSITION_LABEL = {
    zrusene_vratene: "⚠️ zrušené a vrátené",
    zrusene: "⚠️ zrušené",
    zmenene: "⚠️ zmenené",
    potvrdene: "potvrdené",
    odmietnute: "opravný prostriedok odmietnutý",
    zamietnute: "opravný prostriedok zamietnutý",
    // The next two come only from model labels; the text extractor never produces them.
    zastavene: "konanie zastavené",
    porusenie_prava: "konštatované porušenie práva",
    // From model labels, and since 2026-10 also from the extractor (mixed operative verbs).
    ciastocne: "⚠️ čiastočne zrušené alebo zmenené",
    // NOT "preskúmané vyšším súdom". See `kind` below — we cannot support that claim.
    ine: "spomenuté v inom rozhodnutí (bez zisteného výroku)"
};
/** Every value a model estimated is presented as such (design 2026-09-25, R7). */
const MODEL_ESTIMATE_SUFFIX = " (odhad modelu)";
/**
 * Every outcome the regex extractor found is presented as an estimate too (audit
 * 2026-10-09, J2). Stored rows were extracted by older, looser logic that read
 * past-tense descriptions of other courts' acts as outcomes, and the stored row does
 * not say which logic produced it, so no heuristic outcome is stated as a fact.
 */
export const TEXT_ESTIMATE_SUFFIX = " (odhad z textu výroku, over v rozhodnutí)";
/**
 * Is this row's outcome only the text extractor's reading? True for any outcome other
 * than a mention that a model neither estimated nor confidently verified.
 */
export function isTextEstimate(row) {
    return row.disposition !== "ine" && row.dispositionSource !== "model-estimate" && row.verifiedBy !== "model";
}
/**
 * Pick the most adverse known outcome. "Most adverse" rather than most recent on
 * purpose: if any higher court quashed the decision, that is what the lawyer has
 * to know first, even when a later relation merely confirms some other part.
 */
function strongestFlag(rows) {
    if (rows.length === 0)
        return null;
    let best = rows[0];
    let bestRank = DISPOSITION_PRIORITY.indexOf(best.disposition);
    if (bestRank < 0)
        bestRank = DISPOSITION_PRIORITY.length;
    for (const row of rows.slice(1)) {
        let rank = DISPOSITION_PRIORITY.indexOf(row.disposition);
        if (rank < 0)
            rank = DISPOSITION_PRIORITY.length;
        if (rank < bestRank) {
            best = row;
            bestRank = rank;
        }
    }
    const estimated = best.dispositionSource === "model-estimate";
    const textEstimate = isTextEstimate(best);
    const suffix = estimated ? MODEL_ESTIMATE_SUFFIX : textEstimate ? TEXT_ESTIMATE_SUFFIX : "";
    return {
        label: (DISPOSITION_LABEL[best.disposition] ?? best.disposition) + suffix,
        disposition: best.disposition,
        // A detected outcome is evidence of an actual review; its absence is not.
        kind: best.disposition === "ine" ? "mention" : "review",
        reviewedBy: best.sourceCourt,
        // The review is real even when the source decision's stored ref is not a
        // reference at all (the NS API puts subject-matter text in that field), so the
        // outcome stays and only the unusable citation is dropped.
        reviewingRef: asCaseRef(best.sourceRef),
        ...(textEstimate ? { textEstimate: true } : {}),
        ...pickModelOverlay(best)
    };
}
/** Look up the strongest known treatment for a case ref; null when none known. */
export async function buildTreatmentFlag(spisovaZnacka) {
    const ref = spisovaZnacka?.trim();
    if (!ref)
        return null;
    return strongestFlag(await getRelationsReviewing(normalizeCaseRef(ref)));
}
/**
 * Batch version: one query for the whole page of refs.
 *
 * Returned map is keyed by the caller's original ref string. A ref that is absent
 * means "no review on record", which is NOT the same as "still good law" — callers
 * must leave the field off rather than assert validity.
 */
export async function buildTreatmentFlags(refs) {
    const byOriginal = new Map();
    const normByOriginal = new Map();
    for (const raw of refs) {
        // Skip values that are not references at all — they can never match a target
        // ref, so looking them up is pure waste.
        const ref = asCaseRef(raw);
        if (!ref || normByOriginal.has(ref))
            continue;
        normByOriginal.set(ref, normalizeCaseRef(ref));
    }
    if (normByOriginal.size === 0)
        return byOriginal;
    const rowsByNorm = await getRelationsReviewingMany([...normByOriginal.values()]);
    for (const [original, norm] of normByOriginal) {
        const flag = strongestFlag(rowsByNorm.get(norm) ?? []);
        if (flag)
            byOriginal.set(original, flag);
    }
    return byOriginal;
}
/** Annotate presented search items (objects with optional spisovaZnacka) in place-safe copy. */
export async function annotateItemsWithTreatment(items) {
    const flags = await buildTreatmentFlags(items.map((item) => item.spisovaZnacka));
    return items.map((item) => {
        const flag = item.spisovaZnacka ? flags.get(item.spisovaZnacka.trim()) : undefined;
        return flag ? { ...item, treatment: flag } : item;
    });
}
//# sourceMappingURL=treatment-flags.js.map