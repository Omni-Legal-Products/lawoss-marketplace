// src/tools/search-decisions/treatment-flags.ts
import { asCaseRef, normalizeCaseRef } from "../../domain/relation-extractor.js";
import { getRelationsReviewing, getRelationsReviewingMany } from "../../providers/nsud/law-index-store.js";
const DISPOSITION_PRIORITY = [
    "zrusene_vratene",
    "zrusene",
    "zmenene",
    "potvrdene",
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
    // NOT "preskúmané vyšším súdom". See `kind` below — we cannot support that claim.
    ine: "spomenuté v inom rozhodnutí (bez zisteného výroku)"
};
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
    return {
        label: DISPOSITION_LABEL[best.disposition] ?? best.disposition,
        disposition: best.disposition,
        // A detected outcome is evidence of an actual review; its absence is not.
        kind: best.disposition === "ine" ? "mention" : "review",
        reviewedBy: best.sourceCourt,
        // The review is real even when the source decision's stored ref is not a
        // reference at all (the NS API puts subject-matter text in that field), so the
        // outcome stays and only the unusable citation is dropped.
        reviewingRef: asCaseRef(best.sourceRef)
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