// src/domain/relation-model-labels.ts
//
// Model labels for stored relations and how they change what a relation is presented
// as. See docs/superpowers/specs/2026-09-25-model-treatment-layer-design.md.
//
// The heuristic extractor attaches an outcome word found near any mention of the
// target, so "S reviewed T with outcome X" is wrong for about a third of NS/ÚS rows.
// A model answered two typed questions per relation (does S itself dispose of T, and
// what does S's operative part do to T). The raw heuristic rows stay untouched; the
// labels live in their own table and are applied on read, as an estimate.
/** Minimum role probability for the model's role answer to be acted upon. */
export const ROLE_CONFIDENCE_THRESHOLD = 0.65;
export const MODEL_ROLES = ["rozhoduje", "opis_konania", "citacia", "ine"];
export const MODEL_OUTCOMES = [
    "potvrdene",
    "odmietnute",
    "zastavene",
    "zmenene",
    "zrusene",
    "zrusene_vratene",
    "porusenie_prava",
    "ciastocne",
    "ine"
];
const FATE = {
    potvrdene: "stands",
    zamietnute: "stands",
    odmietnute: "stands",
    zastavene: "stands",
    porusenie_prava: "stands",
    zrusene: "quashed",
    zrusene_vratene: "quashed",
    zmenene: "changed",
    ciastocne: "partial",
    ine: "other"
};
function fateOf(disposition) {
    return FATE[disposition] ?? "other";
}
/**
 * Source provider whose relations are looked up even when the heuristic found no
 * outcome (`ine`): regional-court appellate relations from the justice portal. The
 * portal metadata already says S reviews T, but the heuristic rarely finds the
 * outcome in the short appellate operative part, so these rows are mostly `ine`.
 * Their outcome comes from the appeal-outcome label run (design 2026-09-25,
 * section 7). Every other justice relation has no label, so it stays as it is.
 */
const PROVIDER_WITH_OUTCOME_LABELS_FOR_MENTIONS = "justice";
/**
 * Whether a label is consulted at all for a relation with this heuristic disposition
 * and source provider. The read path, the import dry-run and the per-run stats all
 * call this one function, so an import reports exactly what the tools will show.
 *
 * NS and ÚS: labels were produced only for rows with an outcome; a mention (`ine`) is
 * left as is and, on the read path, not even looked up (about 80 % of those relations
 * are mentions). Justice: a label is consulted for every row, `ine` included, which
 * costs one primary-key seek per justice relation that has no outcome.
 */
export function modelLabelApplies(heuristicDisposition, sourceProvider) {
    return heuristicDisposition !== "ine" || sourceProvider === PROVIDER_WITH_OUTCOME_LABELS_FOR_MENTIONS;
}
/**
 * What a label does to one relation, following the presentation table in section 2
 * of the design. Pure: the read path, the import dry-run and the tests share it, so
 * the counts an import reports are the behaviour the server will show.
 */
export function classifyModelLabel(heuristicDisposition, label) {
    const confident = label.roleConfidence >= ROLE_CONFIDENCE_THRESHOLD;
    const uncertain = {
        effect: "uncertain",
        disposition: heuristicDisposition,
        overlay: { uncertain: true }
    };
    if (label.role !== "rozhoduje") {
        if (!confident)
            return uncertain;
        // Not a review: presented as a mention ("ine"), which every reader already treats
        // as "referenced, no outcome" — it drops out of adverse warnings and review flags.
        return {
            effect: "hidden",
            disposition: "ine",
            overlay: {
                dispositionSource: "model-estimate",
                modelConfidence: label.roleConfidence,
                heuristicDisposition
            }
        };
    }
    if (!confident || label.outcome === null || label.outcome === "")
        return uncertain;
    if (fateOf(label.outcome) === fateOf(heuristicDisposition)) {
        return {
            effect: "verified",
            disposition: heuristicDisposition,
            overlay: { verifiedBy: "model" }
        };
    }
    return {
        effect: "corrected",
        disposition: label.outcome,
        overlay: {
            dispositionSource: "model-estimate",
            modelConfidence: label.outcomeConfidence ?? label.roleConfidence,
            heuristicDisposition
        }
    };
}
/**
 * The model-label fields of a relation, copied only when set: anything built from an
 * unlabelled relation must keep exactly its old shape.
 */
export function pickModelOverlay(row) {
    const out = {};
    if (row.dispositionSource !== undefined)
        out.dispositionSource = row.dispositionSource;
    if (row.modelConfidence !== undefined)
        out.modelConfidence = row.modelConfidence;
    if (row.heuristicDisposition !== undefined)
        out.heuristicDisposition = row.heuristicDisposition;
    if (row.verifiedBy !== undefined)
        out.verifiedBy = row.verifiedBy;
    if (row.uncertain !== undefined)
        out.uncertain = row.uncertain;
    return out;
}
//# sourceMappingURL=relation-model-labels.js.map