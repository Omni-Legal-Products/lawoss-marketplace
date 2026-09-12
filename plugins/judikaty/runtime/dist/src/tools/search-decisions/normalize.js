const CASE_REFERENCE_PATTERN = /^\d+[A-Za-zČ-ž]+(?:\/[A-Za-z0-9.-]+)+$/u;
export function normalizeSearchDecisionsInput(input) {
    if (!input.query ||
        input.spisovaZnacka ||
        input.ecli ||
        input.identifikacneCisloSpisu ||
        !looksLikeCaseReference(input.query)) {
        return {
            input,
            coverageNotes: []
        };
    }
    return {
        input: {
            ...input,
            query: undefined,
            spisovaZnacka: input.query
        },
        coverageNotes: [
            "The input query looked like an exact spisova znacka, so search_decisions used the spisovaZnacka field instead of broad full-text query search."
        ]
    };
}
export function appendCoverageNotes(result, extraCoverageNotes) {
    if (extraCoverageNotes.length === 0) {
        return result;
    }
    return {
        ...result,
        coverageNotes: [...new Set([...extraCoverageNotes, ...result.coverageNotes])]
    };
}
export function formatSearchProviderError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === "string" ? error : "Unknown provider error.";
}
function looksLikeCaseReference(value) {
    return CASE_REFERENCE_PATTERN.test(value.trim());
}
//# sourceMappingURL=normalize.js.map