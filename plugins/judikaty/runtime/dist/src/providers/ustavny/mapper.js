import { buildAvailabilityNotes, buildSourceAvailability } from "../../domain/source-availability.js";
import { buildSourceProvenance } from "../../domain/source-provenance.js";
import { buildUstavnyDocumentUrl } from "./client.js";
export const USTAVNY_COURT_NAME = "Ústavný súd Slovenskej republiky";
const USTAVNY_COURT_TYPE = "Ústavný súd SR";
export function mapUstavnyDecisionSummary(item, options) {
    const sourceCompleteness = options?.textContent ? "metadata_text_document" : "metadata_document";
    const sourceAvailability = buildSourceAvailability(sourceCompleteness, options?.textSourceMode === "inline"
        ? "inline"
        : options?.textSourceMode === "pdf_extract"
            ? "pdf_extract"
            : "pdf_extract");
    return {
        provider: "ustavny",
        providerId: item.documentId,
        ecli: emptyToNull(item.mkECLI),
        courtName: USTAVNY_COURT_NAME,
        courtId: null,
        courtType: USTAVNY_COURT_TYPE,
        spisovaZnacka: emptyToNull(item.mkRSAPNumberOfFile),
        identifikacneCisloSpisu: emptyToNull(item.mkRVPNumberOfFile),
        decisionForm: emptyToNull(item.mkFormOfDecision),
        decisionNature: item.mkTypeOfDecision ?? [],
        dateIssued: parseUstavnyDate(item.mkDateOfDecision),
        judgeName: emptyToNull(item.mkJudgeReporter),
        legalAreas: item.mkMaterialRegister ?? [],
        legalSubAreas: item.mkWordRegister ?? [],
        title: emptyToNull(item.mkWebTitle) ?? emptyToNull(item.title) ?? emptyToNull(item.mkRSAPNumberOfFile),
        summary: emptyToNull(item.mkClauseTitle) ?? emptyToNull(item.mkClauseText),
        documentUrl: buildUstavnyDocumentUrl(item.documentId),
        sourceUrl: buildUstavnyDocumentUrl(item.documentId),
        updatedAt: parseUstavnyDate(item.mkPublicationDate),
        retrievedAt: new Date().toISOString(),
        sourceAvailability,
        sourceProvenance: buildSourceProvenance({
            provider: "ustavny",
            availability: sourceAvailability,
            dateIssued: parseUstavnyDate(item.mkDateOfDecision)
        }),
        sourceCompleteness,
        availabilityNotes: buildUstavnyAvailabilityNotes(sourceAvailability, options?.contentError),
        normalizationConfidence: item.mkECLI ? "high" : "medium"
    };
}
export function mapUstavnyDecisionDetail(input) {
    const sourceCompleteness = input.textContent ? "metadata_text_document" : "metadata_document";
    const sourceAvailability = buildSourceAvailability(sourceCompleteness, input.textSourceMode === "inline"
        ? "inline"
        : input.textSourceMode === "pdf_extract"
            ? "pdf_extract"
            : "pdf_extract");
    return {
        provider: "ustavny",
        providerId: input.item.documentId,
        ecli: emptyToNull(input.item.mkECLI),
        court: {
            id: null,
            name: USTAVNY_COURT_NAME,
            type: USTAVNY_COURT_TYPE,
            address: null
        },
        judge: {
            id: null,
            name: emptyToNull(input.item.mkJudgeReporter)
        },
        spisovaZnacka: emptyToNull(input.item.mkRSAPNumberOfFile),
        identifikacneCisloSpisu: emptyToNull(input.item.mkRVPNumberOfFile),
        dateIssued: parseUstavnyDate(input.item.mkDateOfDecision),
        decisionForm: emptyToNull(input.item.mkFormOfDecision),
        decisionNature: input.item.mkTypeOfDecision ?? [],
        legalAreas: input.item.mkMaterialRegister ?? [],
        legalSubAreas: input.item.mkWordRegister ?? [],
        merit: arrayToSentence(input.item.mkResultOfNegotiation) ?? arrayToSentence(input.item.mkCause),
        textContent: input.textContent,
        document: {
            name: buildUstavnyFileName(input.item.mkRSAPNumberOfFile),
            extension: input.item.extension ?? "PDF",
            sizeBytes: input.item.size ?? null,
            url: buildUstavnyDocumentUrl(input.item.documentId)
        },
        citedRegulations: (input.item.mkComplainedLegalRegulation ?? []).map((label) => ({
            label,
            url: null,
            slovLexLawId: null,
            slovLexAnchor: null
        })),
        relatedCase: {
            originalCourt: null,
            originalCaseRef: emptyToNull(input.item.mkFileReference)
        },
        source: {
            provider: "ustavny",
            retrievedAt: new Date().toISOString(),
            sourceUrl: buildUstavnyDocumentUrl(input.item.documentId)
        },
        sourceAvailability,
        sourceProvenance: buildSourceProvenance({
            provider: "ustavny",
            availability: sourceAvailability,
            dateIssued: parseUstavnyDate(input.item.mkDateOfDecision)
        }),
        sourceCompleteness,
        availabilityNotes: buildUstavnyAvailabilityNotes(sourceAvailability, input.contentError),
        normalizationConfidence: input.item.mkECLI ? "high" : "medium"
    };
}
export function mapUstavnyTextWindow(id, text, input) {
    const nextOffset = input.offsetChars + input.maxChars;
    return {
        provider: "ustavny",
        id,
        text: text.slice(input.offsetChars, input.offsetChars + input.maxChars),
        windowComplete: nextOffset >= text.length,
        nextOffset: nextOffset >= text.length ? null : nextOffset,
        sourceMode: "inline",
        textSha256: null
    };
}
export function mapUstavnyRelatedSlovlexContext(item) {
    return {
        decision: {
            provider: "ustavny",
            providerId: item.documentId,
            ecli: emptyToNull(item.mkECLI),
            courtName: USTAVNY_COURT_NAME,
            spisovaZnacka: emptyToNull(item.mkRSAPNumberOfFile),
            dateIssued: parseUstavnyDate(item.mkDateOfDecision)
        },
        citedRegulations: (item.mkComplainedLegalRegulation ?? []).map((label) => ({
            label,
            url: null
        }))
    };
}
export function mapUstavnyResolvedIdentity(item, notes = []) {
    return {
        matched: Boolean(item),
        provider: item ? "ustavny" : null,
        providerId: item?.documentId ?? null,
        ecli: item ? emptyToNull(item.mkECLI) : null,
        spisovaZnacka: item ? emptyToNull(item.mkRSAPNumberOfFile) : null,
        sourceUrl: item ? buildUstavnyDocumentUrl(item.documentId) : null,
        notes
    };
}
export function mapUstavnyDocumentResult(item) {
    return {
        provider: "ustavny",
        id: item.documentId,
        fileName: buildUstavnyFileName(item.mkRSAPNumberOfFile),
        contentType: "application/pdf",
        sourceUrl: buildUstavnyDocumentUrl(item.documentId),
        savedPath: null,
        sizeBytes: item.size ?? null
    };
}
function parseUstavnyDate(value) {
    if (!value) {
        return null;
    }
    const [datePart] = value.split(" ");
    if (!datePart) {
        return null;
    }
    const [month, day, year] = datePart.split("/");
    if (!month || !day || !year) {
        return null;
    }
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
function arrayToSentence(value) {
    return value?.length ? value.join(", ") : null;
}
function emptyToNull(value) {
    if (!value?.trim()) {
        return null;
    }
    return value;
}
function buildUstavnyAvailabilityNotes(availability, contentError) {
    const notes = buildAvailabilityNotes({ ...availability, provider: "ustavny" });
    if (contentError) {
        notes.push(`HTML content endpoint did not provide usable text: ${contentError}`);
    }
    return notes;
}
function buildUstavnyFileName(spisovaZnacka) {
    if (!spisovaZnacka) {
        return "ustavny-rozhodnutie.pdf";
    }
    return `${spisovaZnacka.replace(/[/:]+/g, "_")}.pdf`;
}
//# sourceMappingURL=mapper.js.map