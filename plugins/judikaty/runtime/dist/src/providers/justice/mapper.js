import { buildAvailabilityNotes, buildSourceAvailability } from "../../domain/source-availability.js";
import { buildSourceProvenance } from "../../domain/source-provenance.js";
function parseJusticeDate(value) {
    if (!value) {
        return null;
    }
    const parts = value.split(".");
    if (parts.length !== 3) {
        return null;
    }
    const day = parts[0];
    const month = parts[1];
    const year = parts[2];
    if (!day || !month || !year) {
        return null;
    }
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
function asNumber(value) {
    if (!value) {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
export function mapJusticeDecisionSummary(item) {
    const sourceCompleteness = "metadata";
    const sourceAvailability = buildSourceAvailability(sourceCompleteness, "none");
    return {
        provider: "justice",
        providerId: item.guid,
        ecli: null,
        courtName: item.sud.nazov ?? "Neznámy súd",
        courtId: item.sud.registreGuid ?? null,
        courtType: item.sud.nazov?.split(" ").slice(0, 2).join(" ") ?? null,
        spisovaZnacka: item.spisovaZnacka ?? null,
        identifikacneCisloSpisu: item.identifikacneCislo ?? null,
        decisionForm: item.formaRozhodnutia ?? null,
        decisionNature: item.povaha ?? [],
        dateIssued: parseJusticeDate(item.datumVydania),
        judgeName: item.sudca?.meno ?? null,
        legalAreas: [],
        legalSubAreas: [],
        title: item.spisovaZnacka ?? null,
        summary: null,
        documentUrl: null,
        sourceUrl: buildJusticeDecisionPublicUrl(item.guid),
        updatedAt: null,
        retrievedAt: new Date().toISOString(),
        sourceAvailability,
        sourceProvenance: buildSourceProvenance({
            provider: "justice",
            availability: sourceAvailability,
            dateIssued: parseJusticeDate(item.datumVydania)
        }),
        sourceCompleteness,
        availabilityNotes: buildAvailabilityNotes({ ...sourceAvailability, provider: "justice" }),
        normalizationConfidence: "medium"
    };
}
export function mapJusticeDecisionDetail(item) {
    const dateIssued = parseJusticeDate(item.datumVydania);
    const updatedAt = parseJusticeDate(item.updateDate);
    const sourceCompleteness = item.dokument?.url ? "metadata_document" : "metadata";
    const sourceAvailability = buildSourceAvailability(sourceCompleteness, item.dokument?.url ? "pdf_extract" : "none");
    return {
        provider: "justice",
        providerId: item.guid,
        ecli: item.ecli ?? null,
        court: {
            id: item.sud.registreGuid ?? null,
            name: item.sud.nazov ?? "Neznámy súd",
            type: item.sud.nazov?.split(" ").slice(0, 2).join(" ") ?? null,
            address: null
        },
        judge: {
            id: item.sudca?.registreGuid ?? null,
            name: item.sudca?.meno ?? null
        },
        spisovaZnacka: item.spisovaZnacka ?? null,
        identifikacneCisloSpisu: item.identifikacneCislo ?? null,
        dateIssued,
        decisionForm: item.formaRozhodnutia ?? null,
        decisionNature: item.povaha ?? [],
        legalAreas: item.oblast ?? [],
        legalSubAreas: item.podOblast ?? [],
        merit: null,
        textContent: null,
        document: {
            name: item.dokument?.name ?? null,
            extension: item.dokument?.fileExtension ?? null,
            sizeBytes: item.dokument?.size ?? null,
            url: item.dokument?.url ?? null
        },
        citedRegulations: (item.odkazovanePredpisy ?? []).map((regulation) => ({
            label: regulation.nazov ?? regulation.url ?? "Neznámy predpis",
            url: regulation.url ?? null,
            slovLexLawId: extractSlovLexLawId(regulation.url),
            slovLexAnchor: extractSlovLexAnchor(regulation.url)
        })),
        relatedCase: {
            originalCourt: getOriginalCourtName(item.povodnySud),
            originalCaseRef: item.povodnaSpisovaZnacka ?? null
        },
        source: {
            provider: "justice",
            retrievedAt: new Date().toISOString(),
            sourceUrl: buildJusticeDecisionPublicUrl(item.guid)
        },
        sourceAvailability,
        sourceProvenance: buildSourceProvenance({
            provider: "justice",
            availability: sourceAvailability,
            dateIssued
        }),
        sourceCompleteness,
        availabilityNotes: buildAvailabilityNotes({ ...sourceAvailability, provider: "justice" }),
        normalizationConfidence: updatedAt ? "high" : "medium"
    };
}
function getOriginalCourtName(value) {
    if (!value) {
        return null;
    }
    return typeof value === "string" ? value : value.nazov;
}
export function mapJusticeCourt(item) {
    return {
        provider: "justice",
        providerId: item.registreGuid,
        name: item.nazov,
        type: item.typSudu ?? null,
        region: null,
        district: item.adresa?.obec ?? null,
        address: item.adresaString ?? null,
        coordinates: {
            lat: asNumber(item.suradnice?.zemepisnaSirka),
            lon: asNumber(item.suradnice?.zemepisnaDlzka)
        }
    };
}
export function mapJusticeDecisionAutocompleteItem(item) {
    return {
        provider: "justice",
        id: item.guid,
        label: item.spisovaZnacka ?? item.guid,
        courtName: item.sud ?? "Neznámy súd",
        decisionForm: item.forma ?? null,
        ecli: null
    };
}
export function mapJusticeRelatedSlovlexContext(item) {
    return {
        decision: {
            provider: "justice",
            providerId: item.guid,
            ecli: item.ecli ?? null,
            courtName: item.sud.nazov ?? "Neznámy súd",
            spisovaZnacka: item.spisovaZnacka ?? null,
            dateIssued: parseJusticeDate(item.datumVydania)
        },
        citedRegulations: (item.odkazovanePredpisy ?? []).map((regulation) => ({
            label: regulation.nazov ?? regulation.url ?? "Neznámy predpis",
            url: regulation.url ?? null
        }))
    };
}
export function mapJusticeResolvedIdentity(item, notes = []) {
    return {
        matched: Boolean(item),
        provider: item ? "justice" : null,
        providerId: item?.guid ?? null,
        ecli: item?.ecli ?? null,
        spisovaZnacka: item?.spisovaZnacka ?? null,
        sourceUrl: item ? buildJusticeDecisionPublicUrl(item.guid) : null,
        notes
    };
}
export function buildJusticeDecisionApiUrl(id) {
    return `https://obcan.justice.sk/pilot/api/ress-isu-service/v1/rozhodnutie/${id}`;
}
export function buildJusticeDecisionPublicUrl(id) {
    return `https://www.justice.gov.sk/sudy-a-rozhodnutia/sudy/rozhodnutia/${id}`;
}
function extractSlovLexLawId(url) {
    if (!url) {
        return null;
    }
    const match = url.match(/\/pravne-predpisy\/(SK\/ZZ\/\d{4}\/\d+)/);
    return match?.[1] ?? null;
}
function extractSlovLexAnchor(url) {
    if (!url) {
        return null;
    }
    const hashIndex = url.indexOf("#");
    return hashIndex >= 0 ? url.slice(hashIndex + 1) : null;
}
//# sourceMappingURL=mapper.js.map