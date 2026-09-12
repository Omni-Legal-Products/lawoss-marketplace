export function presentSearchResult(result, view) {
    return {
        total: result.total,
        items: result.items.map((item) => presentDecisionSummary(item, view)),
        providerBreakdown: result.providerBreakdown,
        dedupApplied: result.dedupApplied,
        ...(view === "compact" ? {} : { coverageNotes: result.coverageNotes })
    };
}
export function presentBatchSummaries(items, view) {
    return {
        items: items.map((item) => presentDecisionSummary(item, view))
    };
}
export function presentDecisionSummary(item, view) {
    if (view === "compact") {
        return {
            provider: item.provider,
            providerId: item.providerId,
            ecli: item.ecli,
            spisovaZnacka: item.spisovaZnacka,
            courtName: item.courtName,
            dateIssued: item.dateIssued,
            decisionForm: item.decisionForm,
            availability: item.sourceAvailability.status
        };
    }
    // Standard/full share the same base shape as before this change
    // (kept byte-for-byte identical to preserve those views).
    const base = {
        provider: item.provider,
        providerId: item.providerId,
        ecli: item.ecli,
        courtName: item.courtName,
        spisovaZnacka: item.spisovaZnacka,
        decisionForm: item.decisionForm,
        dateIssued: item.dateIssued,
        title: item.title,
        summary: item.summary,
        sourceAvailability: item.sourceAvailability
    };
    const standard = {
        ...base,
        courtId: item.courtId,
        courtType: item.courtType,
        identifikacneCisloSpisu: item.identifikacneCisloSpisu,
        judgeName: item.judgeName,
        legalAreas: item.legalAreas,
        legalSubAreas: item.legalSubAreas,
        documentUrl: item.documentUrl,
        sourceUrl: item.sourceUrl,
        sourceProvenance: item.sourceProvenance,
        sourceCompleteness: item.sourceCompleteness,
        availabilityNotes: item.availabilityNotes
    };
    if (view === "standard") {
        return standard;
    }
    return {
        ...standard,
        updatedAt: item.updatedAt,
        retrievedAt: item.retrievedAt,
        normalizationConfidence: item.normalizationConfidence
    };
}
export function presentDecisionDetail(detail, input) {
    const compact = {
        provider: detail.provider,
        providerId: detail.providerId,
        ecli: detail.ecli,
        court: {
            name: detail.court.name,
            type: detail.court.type
        },
        judge: {
            name: detail.judge.name
        },
        spisovaZnacka: detail.spisovaZnacka,
        identifikacneCisloSpisu: detail.identifikacneCisloSpisu,
        dateIssued: detail.dateIssued,
        decisionForm: detail.decisionForm,
        decisionNature: detail.decisionNature,
        legalAreas: detail.legalAreas,
        legalSubAreas: detail.legalSubAreas,
        merit: detail.merit,
        sourceAvailability: detail.sourceAvailability
    };
    if (input.view === "compact") {
        return addOptionalDetailSections(compact, detail, input.include);
    }
    const standard = {
        ...compact,
        court: detail.court,
        judge: detail.judge,
        sourceProvenance: detail.sourceProvenance,
        sourceCompleteness: detail.sourceCompleteness,
        availabilityNotes: detail.availabilityNotes
    };
    if (input.view === "standard") {
        return addOptionalDetailSections(standard, detail, input.include);
    }
    const full = {
        ...standard,
        textContent: detail.textContent,
        source: detail.source,
        normalizationConfidence: detail.normalizationConfidence
    };
    return addOptionalDetailSections(full, detail, input.include);
}
function addOptionalDetailSections(target, detail, include) {
    if (include.includes("document")) {
        target.document = detail.document;
    }
    if (include.includes("citedRegulations")) {
        target.citedRegulations = detail.citedRegulations;
    }
    if (include.includes("relatedCase")) {
        target.relatedCase = detail.relatedCase;
    }
    if (include.includes("textPreview")) {
        target.textPreview = detail.textContent ? detail.textContent.slice(0, 1200) : null;
    }
    return target;
}
//# sourceMappingURL=presenters.js.map