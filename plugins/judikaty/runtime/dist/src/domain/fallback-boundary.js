export function buildSearchFallbackBoundary(input, totalResults) {
    if (totalResults > 0 || !isExactLookupInput(input)) {
        return null;
    }
    return {
        suggested: true,
        category: isHistoricalRange(input.dateFrom, input.dateTo)
            ? "archival_or_licensed_follow_up"
            : "manual_public_lookup",
        notes: [
            "No public provider returned a match for this exact decision reference.",
            "For older and lower-court decisions, this may reflect an upstream Ministry indexing gap rather than proof that the decision is unavailable.",
            "Recommended follow-up boundary: direct justice portal lookup, court publication page, or archival/licensed source if the decision is known to exist."
        ]
    };
}
export function buildLawSearchFallbackBoundary(input, totalResults) {
    if (totalResults > 0) {
        return null;
    }
    return {
        suggested: true,
        category: "manual_public_lookup",
        notes: [
            "No public provider returned a match for this law reference.",
            "Law-based retrieval is best-effort only, especially for older decisions where cited-law metadata is missing or inconsistent.",
            "Recommended follow-up boundary: retry by exact spisova znacka or ECLI, then continue with direct portal lookup if the decision is known to exist."
        ]
    };
}
/**
 * Note prefix a provider uses when a reference matches several decisions it cannot
 * choose between (e.g. one spisová značka at several courts). The candidate notes
 * that follow are the answer; no fallback boundary is attached on top of them.
 */
export const AMBIGUOUS_REFERENCE_NOTE_PREFIX = "Ambiguous reference:";
const PROVIDER_NOT_ANSWERED_RE = /^Provider (\S+) did not answer this lookup\b/;
/** Note naming a provider whose lookup failed or that could not be queried. */
export function buildProviderNotAnsweredNote(provider, reason) {
    return (`Provider ${provider} did not answer this lookup: ${reason}. ` +
        "A miss from the remaining providers is not evidence that the decision is unavailable.");
}
export function isAmbiguousResolution(resolution) {
    return (!resolution.matched &&
        resolution.notes.some((note) => note.startsWith(AMBIGUOUS_REFERENCE_NOTE_PREFIX)));
}
function unansweredProviders(resolution) {
    const providers = resolution.notes
        .map((note) => PROVIDER_NOT_ANSWERED_RE.exec(note)?.[1])
        .filter((provider) => Boolean(provider));
    return [...new Set(providers)];
}
/**
 * Constitutional Court (Ústavný súd) reference shapes: "PL. ÚS 3/09",
 * "III. ÚS 120/2020", or an ECLI issued by the court (":USSR:").
 */
export function looksLikeConstitutionalCourtReference(value) {
    if (!value) {
        return false;
    }
    const folded = value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();
    return /:USSR:/.test(folded) || /(?:^|[^A-Z])(?:PL|[IVX]+)\.?\s*US\b/.test(folded);
}
export function buildReferenceFallbackBoundary(input) {
    if (input.resolution.matched || isAmbiguousResolution(input.resolution)) {
        return null;
    }
    const unanswered = unansweredProviders(input.resolution);
    if (unanswered.length > 0) {
        return {
            suggested: true,
            category: "manual_public_lookup",
            notes: [
                `The decision could not be confirmed because not every relevant provider answered: ${unanswered.join(", ")}.`,
                "This is not evidence that the decision is unavailable; retry the lookup or query that provider directly.",
                "Recommended follow-up boundary: retry first, then direct portal lookup or court-site search when the public record is known to exist."
            ]
        };
    }
    const notes = [
        "The decision could not be resolved from the currently queried public providers.",
        "For exact lower-court and older references, a miss can still be an upstream indexing gap.",
        "Recommended follow-up boundary: direct portal lookup, court-site search, or archival/licensed source when the public record is known to exist."
    ];
    if (input.provider !== "auto" &&
        input.provider !== "ustavny" &&
        looksLikeConstitutionalCourtReference(input.reference)) {
        notes.push(`This looks like a Constitutional Court (Ústavný súd) reference, which provider "${input.provider}" does not cover; retry with provider "ustavny" or "auto".`);
    }
    return {
        suggested: true,
        category: looksLikeExactReference(input.reference)
            ? "manual_public_lookup"
            : "archival_or_licensed_follow_up",
        notes
    };
}
function isExactLookupInput(input) {
    return Boolean(input.spisovaZnacka || input.ecli || (input.query && looksLikeCaseReference(input.query)));
}
function looksLikeCaseReference(value) {
    return /^\d+[A-Za-zČ-ž]+(?:\/[A-Za-z0-9.-]+)+$/u.test(value.trim());
}
function looksLikeExactReference(value) {
    return (looksLikeCaseReference(value) ||
        /^ECLI:/i.test(value.trim()) ||
        looksLikeConstitutionalCourtReference(value));
}
function isHistoricalRange(dateFrom, dateTo) {
    const candidate = dateTo ?? dateFrom;
    if (!candidate) {
        return false;
    }
    const year = Number(candidate.slice(0, 4));
    return Number.isFinite(year) && year <= 2010;
}
//# sourceMappingURL=fallback-boundary.js.map