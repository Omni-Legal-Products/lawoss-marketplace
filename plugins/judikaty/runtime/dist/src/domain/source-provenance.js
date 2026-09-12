export function buildSourceProvenance(input) {
    switch (input.provider) {
        case "justice":
            return {
                originSystem: "Ministerstvo spravodlivosti SR pilot API",
                originType: "official_api",
                official: true,
                collection: "justice decisions index",
                fallbackSuggested: input.availability.status === "metadata_only",
                fallbackReason: input.availability.status === "metadata_only"
                    ? "Ministry source exposes metadata only here; older or lower-court coverage may require archival or licensed follow-up."
                    : null
            };
        case "nsud":
            return {
                originSystem: "Najvyssi sud SR official decisions portal",
                originType: "official_web",
                official: true,
                collection: "nsud decisions portal",
                fallbackSuggested: false,
                fallbackReason: null
            };
        case "ustavny":
            return {
                originSystem: "Ustavny sud SR DMS API",
                originType: "official_dms",
                official: true,
                collection: isDigitizedLegacyDecision(input.dateIssued)
                    ? "digitized decisions 1993-2004"
                    : "constitutional court decisions",
                fallbackSuggested: input.availability.status === "metadata_only",
                fallbackReason: input.availability.status === "metadata_only"
                    ? "Official Constitutional Court source did not yield usable text or PDF-derived text; manual archival follow-up may still be needed."
                    : null
            };
    }
}
function isDigitizedLegacyDecision(dateIssued) {
    if (!dateIssued) {
        return false;
    }
    const year = Number(dateIssued.slice(0, 4));
    return Number.isFinite(year) && year <= 2004;
}
//# sourceMappingURL=source-provenance.js.map