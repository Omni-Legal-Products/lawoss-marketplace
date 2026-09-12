export function buildDecisionMarkdownWindow(input) {
    const metadataIncluded = input.includeMetadata ?? true;
    const header = metadataIncluded
        ? renderMetadataHeader(input.detail, input.textWindow.sourceMode)
        : "";
    const separator = metadataIncluded ? "\n\n## Text\n\n" : "";
    return {
        provider: input.textWindow.provider,
        id: input.textWindow.id,
        markdown: `${header}${separator}${normalizeExtractedText(input.textWindow.text)}`.trim(),
        windowComplete: input.textWindow.windowComplete,
        nextOffset: input.textWindow.nextOffset,
        sourceMode: input.textWindow.sourceMode,
        textSha256: input.textWindow.textSha256,
        metadataIncluded
    };
}
function renderMetadataHeader(detail, sourceMode) {
    const lines = [
        `# ${detail.decisionForm ?? "Rozhodnutie"} ${detail.spisovaZnacka ?? detail.providerId}`,
        "",
        `- Súd: ${detail.court.name}`,
        `- Spisová značka: ${detail.spisovaZnacka ?? "neuvedené"}`,
        `- ECLI: ${detail.ecli ?? "neuvedené"}`,
        `- Dátum vydania: ${detail.dateIssued ?? "neuvedené"}`,
        `- Forma rozhodnutia: ${detail.decisionForm ?? "neuvedené"}`,
        `- Zdroj textu: ${sourceMode}`,
        `- Zdroj rozhodnutia: ${detail.source.sourceUrl ?? "neuvedené"}`,
        `- Proveniencia: ${detail.sourceProvenance.originSystem} (${detail.sourceProvenance.originType})`
    ];
    if (detail.document.url) {
        lines.push(`- Dokument PDF: ${detail.document.url}`);
    }
    if (detail.sourceProvenance.fallbackSuggested) {
        lines.push(`- Fallback odporucany: ${detail.sourceProvenance.fallbackReason ?? "ano"}`);
    }
    return lines.join("\n");
}
function normalizeExtractedText(text) {
    return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
//# sourceMappingURL=markdown.js.map