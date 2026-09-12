export function buildSourceAvailability(sourceCompleteness, textSourceMode) {
    const documentAvailable = sourceCompleteness === "metadata_document" || sourceCompleteness === "metadata_text_document";
    const textAvailable = sourceCompleteness === "metadata_text" || sourceCompleteness === "metadata_text_document";
    const textDerivableFromDocument = !textAvailable && documentAvailable && textSourceMode === "pdf_extract";
    return {
        metadataAvailable: true,
        documentAvailable,
        textAvailable,
        textDerivableFromDocument,
        textSourceMode,
        status: textAvailable ? "text_available" : documentAvailable ? "pdf_available" : "metadata_only"
    };
}
export function buildAvailabilityNotes(input) {
    if (input.textAvailable && input.documentAvailable) {
        return [`${input.provider} exposes inline text and a linked decision document.`];
    }
    if (input.textAvailable) {
        return [`${input.provider} exposes inline decision text.`];
    }
    if (input.textDerivableFromDocument) {
        return [
            `${input.provider} exposes a decision PDF, but not normalized text. Use get_decision_text for extraction.`
        ];
    }
    if (input.documentAvailable) {
        return [`${input.provider} exposes a decision document, but text availability is not normalized.`];
    }
    return [`${input.provider} currently exposes metadata only for this decision.`];
}
//# sourceMappingURL=source-availability.js.map