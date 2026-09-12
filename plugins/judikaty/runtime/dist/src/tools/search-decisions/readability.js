export function decisionReadabilityScore(item) {
    switch (item.sourceAvailability.status) {
        case "text_available":
            return 30;
        case "pdf_available":
            return 20;
        case "metadata_only":
        default:
            return 10;
    }
}
export function canAttemptTextExtraction(item) {
    return (item.sourceAvailability.textAvailable ||
        item.sourceAvailability.textDerivableFromDocument ||
        item.sourceAvailability.documentAvailable);
}
export function stripMergedCoverageNotes(notes) {
    return notes.filter((note) => !/results in this page:/i.test(note) &&
        !/currently contributes text-ready results/i.test(note));
}
//# sourceMappingURL=readability.js.map