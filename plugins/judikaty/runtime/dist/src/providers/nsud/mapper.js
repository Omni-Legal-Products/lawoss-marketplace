import { createHash } from "node:crypto";
import { looksLikeCaseRef } from "../../domain/relation-extractor.js";
import { buildAvailabilityNotes, buildSourceAvailability } from "../../domain/source-availability.js";
import { buildSourceProvenance } from "../../domain/source-provenance.js";
export const NSUD_COURT_NAME = "Najvyšší súd Slovenskej republiky";
export const NSUD_COURT_TYPE = "Najvyšší súd SR";
export function mapNsudDecisionSummary(id, item) {
    const sourceCompleteness = deriveCompleteness(item);
    const sourceAvailability = buildSourceAvailability(sourceCompleteness, deriveNsudTextSourceMode(item));
    return {
        provider: "nsud",
        providerId: id,
        ecli: emptyToNull(item.ecli),
        courtName: NSUD_COURT_NAME,
        courtId: null,
        courtType: NSUD_COURT_TYPE,
        spisovaZnacka: emptyToNull(item.cislo),
        identifikacneCisloSpisu: extractSpisIdFromEcli(item.ecli),
        decisionForm: inferDecisionForm(item.obsah),
        decisionNature: [],
        dateIssued: emptyToNull(item.datum),
        judgeName: emptyToNull(item.sudca),
        legalAreas: kolegiumToAreas(item.kolegium),
        legalSubAreas: [],
        title: emptyToNull(item.cislo),
        summary: emptyToNull(item.merito),
        documentUrl: buildNsudDocumentUrl(item.subor),
        sourceUrl: buildNsudDecisionPageUrl(item.cislo),
        updatedAt: null,
        retrievedAt: new Date().toISOString(),
        sourceAvailability,
        sourceProvenance: buildSourceProvenance({
            provider: "nsud",
            availability: sourceAvailability,
            dateIssued: emptyToNull(item.datum)
        }),
        sourceCompleteness,
        availabilityNotes: buildAvailabilityNotes({ ...sourceAvailability, provider: "nsud" }),
        normalizationConfidence: "medium"
    };
}
export function mapNsudDecisionDetail(id, item) {
    const sourceCompleteness = deriveCompleteness(item);
    const sourceAvailability = buildSourceAvailability(sourceCompleteness, deriveNsudTextSourceMode(item));
    return {
        provider: "nsud",
        providerId: id,
        ecli: emptyToNull(item.ecli),
        court: {
            id: null,
            name: NSUD_COURT_NAME,
            type: NSUD_COURT_TYPE,
            address: null
        },
        judge: {
            id: null,
            name: emptyToNull(item.sudca)
        },
        spisovaZnacka: emptyToNull(item.cislo),
        identifikacneCisloSpisu: extractSpisIdFromEcli(item.ecli),
        dateIssued: emptyToNull(item.datum),
        decisionForm: inferDecisionForm(item.obsah),
        decisionNature: [],
        legalAreas: kolegiumToAreas(item.kolegium),
        legalSubAreas: [],
        merit: emptyToNull(item.merito),
        textContent: emptyToNull(item.obsah),
        document: {
            name: fileNameFromPath(item.subor),
            extension: fileExtensionFromPath(item.subor),
            sizeBytes: null,
            url: buildNsudDocumentUrl(item.subor)
        },
        citedRegulations: [],
        relatedCase: {
            originalCourt: null,
            originalCaseRef: null
        },
        source: {
            provider: "nsud",
            retrievedAt: new Date().toISOString(),
            sourceUrl: buildNsudDecisionPageUrl(item.cislo)
        },
        sourceAvailability,
        sourceProvenance: buildSourceProvenance({
            provider: "nsud",
            availability: sourceAvailability,
            dateIssued: emptyToNull(item.datum)
        }),
        sourceCompleteness,
        availabilityNotes: buildAvailabilityNotes({ ...sourceAvailability, provider: "nsud" }),
        normalizationConfidence: "medium"
    };
}
export function mapNsudTextWindow(id, item, input) {
    const fullText = item.obsah ?? "";
    const text = fullText.slice(input.offsetChars, input.offsetChars + input.maxChars);
    const nextOffset = input.offsetChars + input.maxChars;
    return {
        provider: "nsud",
        id,
        text,
        windowComplete: nextOffset >= fullText.length,
        nextOffset: nextOffset >= fullText.length ? null : nextOffset,
        sourceMode: "inline",
        textSha256: fullText ? createHash("sha256").update(fullText).digest("hex") : null
    };
}
export function mapNsudRelatedSlovlexContext(id, item) {
    return {
        decision: {
            provider: "nsud",
            providerId: id,
            ecli: emptyToNull(item.ecli),
            courtName: NSUD_COURT_NAME,
            spisovaZnacka: emptyToNull(item.cislo),
            dateIssued: emptyToNull(item.datum)
        },
        citedRegulations: []
    };
}
export function mapNsudResolvedIdentity(id, item, notes = []) {
    return {
        matched: Boolean(id && item),
        provider: id && item ? "nsud" : null,
        providerId: id,
        ecli: item ? emptyToNull(item.ecli) : null,
        spisovaZnacka: item ? emptyToNull(item.cislo) : null,
        sourceUrl: item ? buildNsudDecisionPageUrl(item.cislo) : null,
        notes
    };
}
export function mapNsudDocumentResult(id, item) {
    return {
        provider: "nsud",
        id,
        fileName: fileNameFromPath(item.subor),
        contentType: item.subor?.toLowerCase().endsWith(".pdf") ? "application/pdf" : null,
        sourceUrl: buildNsudDocumentUrl(item.subor),
        savedPath: null,
        sizeBytes: null
    };
}
export function buildNsudDocumentUrl(path) {
    if (!path) {
        return null;
    }
    return `https://www.nsud.sk/data/att/${path}`;
}
/**
 * `spisovaZnacka` is polluted for 41.6% of NS records -- the `cislo` field
 * sometimes holds the subject of the proceedings ("dovolanie obvineného")
 * rather than a reference. Building a deep link from that text produces a
 * plausible-looking but fabricated URL that resolves to nothing, which is
 * worse than no link. `looksLikeCaseRef` is the same guard every other read
 * path already uses to validate this field (see domain/decision-identity.ts).
 */
export function buildNsudDecisionPageUrl(spisovaZnacka) {
    if (!spisovaZnacka || !looksLikeCaseRef(spisovaZnacka)) {
        return null;
    }
    const slug = spisovaZnacka.toLowerCase().replace(/[^a-z0-9]/g, "");
    return `https://www.nsud.sk/rozhodnutia/${slug}/`;
}
function kolegiumToAreas(kolegium) {
    switch (kolegium) {
        case "1":
            return ["Občianskoprávne"];
        case "2":
            return ["Obchodnoprávne"];
        case "3":
            return ["Správne"];
        case "4":
            return ["Trestnoprávne"];
        default:
            return [];
    }
}
function deriveCompleteness(item) {
    if (item.obsah && item.subor) {
        return "metadata_text_document";
    }
    if (item.obsah) {
        return "metadata_text";
    }
    if (item.subor) {
        return "metadata_document";
    }
    return "metadata";
}
function deriveNsudTextSourceMode(item) {
    if (item.obsah) {
        return "inline";
    }
    if (item.subor?.toLowerCase().endsWith(".pdf")) {
        return "pdf_extract";
    }
    return "none";
}
function inferDecisionForm(text) {
    if (!text) {
        return null;
    }
    if (text.includes("Uznesenie")) {
        return "Uznesenie";
    }
    if (text.includes("Rozsudok")) {
        return "Rozsudok";
    }
    return null;
}
export function extractSpisIdFromEcli(ecli) {
    if (!ecli) {
        return null;
    }
    const match = ecli.match(/:(\d{10,})\.\d+$/);
    return match?.[1] ?? null;
}
function fileNameFromPath(path) {
    if (!path) {
        return null;
    }
    return path.split("/").at(-1) ?? null;
}
function fileExtensionFromPath(path) {
    const fileName = fileNameFromPath(path);
    if (!fileName || !fileName.includes(".")) {
        return null;
    }
    return fileName.split(".").at(-1)?.toUpperCase() ?? null;
}
function emptyToNull(value) {
    if (!value?.trim()) {
        return null;
    }
    return value;
}
//# sourceMappingURL=mapper.js.map