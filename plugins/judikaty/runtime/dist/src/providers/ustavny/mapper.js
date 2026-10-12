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
        title: buildUstavnyTitle(item),
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
        merit: isFinalDecisionOfFile(input.item) ? uniqueSentence(input.item.mkResultOfNegotiation) : null,
        textContent: input.textContent,
        document: {
            name: buildUstavnyFileName(input.item.mkRSAPNumberOfFile),
            extension: input.item.extension ?? "PDF",
            sizeBytes: input.item.size ?? null,
            url: buildUstavnyDocumentUrl(input.item.documentId)
        },
        citedRegulations: buildComplainedProvisionLabels(input.item).map((label) => ({
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
        availabilityNotes: [
            ...buildUstavnyAvailabilityNotes(sourceAvailability, input.contentError),
            ...buildUstavnyMetadataNotes(input.item)
        ],
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
        citedRegulations: buildComplainedProvisionLabels(item).map((label) => ({
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
// The DMS repeats a value once per petition point ("právo porušené bolo" x33),
// so every list is de-duplicated (first occurrence wins) before it is shown.
function uniqueValues(value) {
    const seen = new Set();
    const out = [];
    for (const raw of value ?? []) {
        const normalized = normalizeSpaces(raw);
        if (normalized && !seen.has(normalized)) {
            seen.add(normalized);
            out.push(normalized);
        }
    }
    return out;
}
function uniqueSentence(value) {
    const values = uniqueValues(value);
    return values.length ? values.join(", ") : null;
}
// The DMS mixes non-breaking spaces into codelist values
// ("Uznesenie o\u00a0námietke zaujatosti").
function normalizeSpaces(value) {
    return value.replace(/\s+/g, " ").trim();
}
// Decision types that close the file: the operative part of such a document is
// the outcome of the proceedings, so its mkResultOfNegotiation is its own result.
const FILE_CLOSING_DECISION_TYPES = [/^nález$/i, /^uznesenie o odmietnutí/i, /^uznesenie o zastavení/i];
/**
 * Whether this document is the decision that closes its file.
 *
 * mkResultOfNegotiation is not reliably a per-document field. In current
 * records it is (an "Uznesenie o prijatí" carries "prijíma na ďalšie
 * konanie"), but in older ones it repeats the result of the whole file: the
 * 2009 admission resolution in PL. ÚS 3/09 carries the 2011 nález's
 * "porušené bolo". The value is only presented as this document's merit when
 * every decision type the document declares closes the file; dissenting
 * opinions and documents without a type never qualify.
 */
function isFinalDecisionOfFile(item) {
    if (emptyToNull(item.mkDifferentView)) {
        return false;
    }
    const types = uniqueValues(item.mkTypeOfDecision);
    const declared = types.length ? types : uniqueValues(item.mkFormOfDecision ? [item.mkFormOfDecision] : []);
    return (declared.length > 0 &&
        declared.every((type) => FILE_CLOSING_DECISION_TYPES.some((pattern) => pattern.test(type))));
}
const COMPLAINED_PROVISION_PREFIX = "Namietané ustanovenie: ";
/**
 * mkComplainedLegalRegulation holds the provisions the petitioner complains
 * of -- in complaint proceedings the rights alleged to be violated (Ústava
 * čl. 48 ods. 2, Dohovor čl. 6 ods. 1), otherwise a challenged regulation
 * (empty in the conformity-proceedings records sampled on 2026-10-12) -- not
 * the regulations the decision itself cites.
 * The field names of the contract stay, so the role travels in the label.
 */
function buildComplainedProvisionLabels(item) {
    return uniqueValues(item.mkComplainedLegalRegulation).map((label) => `${COMPLAINED_PROVISION_PREFIX}${label}`);
}
function buildUstavnyMetadataNotes(item) {
    const notes = [];
    const result = uniqueSentence(item.mkResultOfNegotiation);
    const cause = uniqueSentence(item.mkCause);
    if (result && !isFinalDecisionOfFile(item)) {
        notes.push(`Výsledok prerokovania na úrovni spisu (nie nutne tohto dokumentu): ${result}.`);
    }
    if (cause) {
        notes.push(`Dôvod podľa metadát ÚS (mkCause, napr. dôvod odmietnutia alebo zastavenia; nie predmet konania): ${cause}.`);
    }
    if (item.mkComplainedLegalRegulation?.length) {
        notes.push("citedRegulations pre ÚS pochádzajú z metadát ÚS (mkComplainedLegalRegulation): ide o namietané " +
            "ustanovenia (práva, ktorých porušenie navrhovateľ namieta, alebo napadnutý predpis), nie o predpisy " +
            "citované v texte rozhodnutia.");
    }
    return notes;
}
/**
 * mkWebTitle is empty in search documents and `title` only repeats the DMS
 * document type ("Rozhodnutie - Rozhodnutie"), so the title is built from the
 * decision type and the file reference instead.
 */
function buildUstavnyTitle(item) {
    const webTitle = emptyToNull(item.mkWebTitle);
    if (webTitle) {
        return webTitle;
    }
    const documentType = normalizeSpaces(item.mkDocumentType ?? item.title ?? "").replace(/^Rozhodnutie\s*-\s*/i, "");
    const kind = uniqueValues(item.mkTypeOfDecision)[0] ??
        (documentType && !/^rozhodnutie$/i.test(documentType) ? documentType : null) ??
        emptyToNull(item.mkFormOfDecision);
    const reference = emptyToNull(item.mkRSAPNumberOfFile);
    if (reference && kind) {
        return `${reference} – ${kind}`;
    }
    return reference ?? kind ?? emptyToNull(item.title);
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