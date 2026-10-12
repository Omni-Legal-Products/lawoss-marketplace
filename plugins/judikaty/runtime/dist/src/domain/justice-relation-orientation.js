// src/domain/justice-relation-orientation.ts
import { asCaseRef, normalizeCaseRef, ownRefNorms, stripCourtPrefix } from "./relation-extractor.js";
function despace(value) {
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, "");
}
/** Court instance from its name: 1 district/municipal, 2 regional, 3 supreme; null if unknown. */
export function courtInstance(name) {
    const key = name ? despace(name) : "";
    if (key.startsWith("okresnysud") || key.startsWith("mestskysud"))
        return 1;
    if (key.startsWith("krajskysud"))
        return 2;
    if (key.startsWith("najvyssisud"))
        return 3;
    return null;
}
/**
 * Registers of appeal and cassation files (regional and supreme courts): Co*, To,
 * Tos, Ntc, Cdo, Obdo, Tdo, So, Sžo*. A first-instance number in one of these is a
 * regional file under another number, never a lower court's decision.
 */
const APPELLATE_REGISTER_RE = /^\d+\s*(CO[A-Z]*|TOS?|NTC|CDO|OBDO|TDO|SO|SZO[A-Z]*)\s*\//;
function isAppellateRegister(ref) {
    return APPELLATE_REGISTER_RE.test(despace(ref).toUpperCase());
}
/**
 * Compare the deciding court with the lower court: `povodnySud` when present, else
 * the court now holding the file (detail `sud`), which is the first-instance court or
 * its successor. Null when either instance is unknown.
 */
function instanceStep(decidingCourt, originalCourt, detailCourt) {
    const decider = courtInstance(decidingCourt);
    const lowerName = originalCourt?.trim() || detailCourt?.trim() || null;
    const lower = courtInstance(lowerName);
    if (decider === null || lower === null)
        return null;
    return decider > lower ? "higher" : "notHigher";
}
/**
 * Decide which way a portal decision's relation points, from the data itself.
 *
 * The portal's detail was assumed to carry the decision's own number in
 * `spisovaZnacka` and the reviewed file in `povodnaSpisovaZnacka`. Measured on the
 * production index snapshot of 2026-09-23 it never does: every one of 443,622 rows
 * with list metadata had `povodnaSpisovaZnacka` equal to the decision's own number.
 * For 27,665 regional-court decisions `spisovaZnacka` held the first-instance file
 * (e.g. own "5Co/397/2012", detail "B2-10C/221/2011"), so the review was stored
 * backwards and a lookup of the district file never found it. The documented shape is
 * still honoured when it appears (own number is not in `povodnaSpisovaZnacka`).
 */
export function orientJusticeRelation(input) {
    const originalRef = input.originalRef?.trim();
    if (!originalRef)
        return { kind: "none" };
    const originalNorm = normalizeCaseRef(originalRef);
    if (!originalNorm)
        return { kind: "none" };
    const own = ownRefNorms(input.ownRef, null);
    if (own.has(originalNorm)) {
        // Portal shape: povodnaSpisovaZnacka is our own number; the other file, if any,
        // is the court-prefixed detail number.
        const detail = input.detailRef?.trim();
        if (!detail)
            return { kind: "self" };
        const target = stripCourtPrefix(detail) ?? asCaseRef(detail);
        if (!target)
            return { kind: "none" };
        const targetNorm = normalizeCaseRef(target);
        if (own.has(targetNorm))
            return { kind: "self" };
        const step = instanceStep(input.decidingCourt, input.originalCourt, input.detailCourt);
        if (step === null)
            return { kind: "unknownOriginalCourt" };
        if (step === "notHigher")
            return { kind: "lateral" };
        if (isAppellateRegister(target))
            return { kind: "appellateTarget" };
        return {
            kind: "reviews",
            sourceRef: input.ownRef?.trim() || null,
            sourceCourt: input.decidingCourt?.trim() || null,
            targetRef: target,
            targetRefNorm: targetNorm,
            targetCourt: input.originalCourt?.trim() || null
        };
    }
    // Documented shape: the detail number is our own, povodnaSpisovaZnacka the reviewed file.
    if (ownRefNorms(input.detailRef, null).has(originalNorm))
        return { kind: "self" };
    return {
        kind: "reviews",
        sourceRef: input.detailRef?.trim() || null,
        sourceCourt: input.detailCourt?.trim() || null,
        targetRef: originalRef,
        targetRefNorm: originalNorm,
        targetCourt: input.originalCourt?.trim() || null
    };
}
/**
 * May an inverted row be dropped in favour of an already-stored row with the corrected
 * target? Only when the inverted row carries no outcome the existing one lacks.
 */
export function existingRelationCovers(existing, inverted) {
    return inverted.disposition === "ine" || existing.disposition === inverted.disposition;
}
//# sourceMappingURL=justice-relation-orientation.js.map