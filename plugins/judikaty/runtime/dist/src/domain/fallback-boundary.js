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
export function buildReferenceFallbackBoundary(input) {
    if (input.resolution.matched) {
        return null;
    }
    return {
        suggested: true,
        category: looksLikeCaseReference(input.reference)
            ? "manual_public_lookup"
            : "archival_or_licensed_follow_up",
        notes: [
            "The decision could not be resolved from the currently queried public providers.",
            "For exact lower-court and older references, a miss can still be an upstream indexing gap.",
            "Recommended follow-up boundary: direct portal lookup, court-site search, or archival/licensed source when the public record is known to exist."
        ]
    };
}
function isExactLookupInput(input) {
    return Boolean(input.spisovaZnacka || input.ecli || (input.query && looksLikeCaseReference(input.query)));
}
function looksLikeCaseReference(value) {
    return /^\d+[A-Za-zČ-ž]+(?:\/[A-Za-z0-9.-]+)+$/u.test(value.trim());
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