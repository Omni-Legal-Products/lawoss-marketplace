import { CELEX_ACT_TYPES, CELEX_CASE_LAW_TYPES, CELEX_PREP_TYPES, CELEX_EFTA_TYPES } from "./constants.js";
// Validate and parse a CELEX number
export function parseCelex(celex) {
    const upper = celex.trim().toUpperCase();
    if (upper.length < 7) {
        return { valid: false, error: `CELEX number too short: "${celex}"` };
    }
    // Sector: first character
    const sector = upper[0];
    const knownSectors = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "E"];
    if (!knownSectors.includes(sector)) {
        return { valid: false, error: `Unknown sector "${sector}" in CELEX "${celex}"` };
    }
    // Year: characters 1-4 (4 digits)
    const yearStr = upper.substring(1, 5);
    if (!/^\d{4}$/.test(yearStr)) {
        return { valid: false, error: `Invalid year "${yearStr}" in CELEX "${celex}"` };
    }
    const year = yearStr;
    // After sector+year, parse document type (letters) + number
    const rest = upper.substring(5);
    const typeMatch = rest.match(/^([A-Z]+)(\d+)(.*)?$/);
    if (!typeMatch) {
        return { valid: false, error: `Cannot parse document type/number from "${rest}" in CELEX "${celex}"` };
    }
    const documentType = typeMatch[1];
    const documentNumber = typeMatch[2];
    const suffix = typeMatch[3] || undefined;
    const sectorDescription = getSectorDescription(sector);
    const documentTypeDescription = getDocTypeDescription(sector, documentType);
    const isConsolidated = sector === "0";
    const humanReadable = buildHumanReadable(sector, year, documentType, documentNumber, documentTypeDescription, isConsolidated);
    return {
        valid: true,
        parsed: {
            raw: upper,
            sector,
            sectorDescription,
            year,
            documentType,
            documentTypeDescription,
            documentNumber,
            suffix: suffix || undefined,
            isConsolidated,
            humanReadable,
        }
    };
}
function getSectorDescription(sector) {
    const map = {
        "0": "Consolidated legislation",
        "1": "Treaties",
        "2": "International agreements",
        "3": "Acts of EU institutions",
        "4": "Complementary legislation",
        "5": "Preparatory acts",
        "6": "EU case law (CJEU, General Court, Civil Service Tribunal)",
        "7": "National transposition measures",
        "8": "National case law (incl. ECtHR, EFTA Court)",
        "9": "Parliamentary questions",
        "C": "Other acts (OJ C series)",
        "E": "EFTA documents (incl. EFTA Court decisions)",
    };
    return map[sector] ?? `Sector ${sector}`;
}
function getDocTypeDescription(sector, docType) {
    if (sector === "6" || sector === "8") {
        return CELEX_CASE_LAW_TYPES[docType] ?? `Case law document type ${docType}`;
    }
    if (sector === "5") {
        return CELEX_PREP_TYPES[docType] ?? CELEX_ACT_TYPES[docType] ?? `Preparatory act type ${docType}`;
    }
    if (sector === "E") {
        return CELEX_EFTA_TYPES[docType] ?? `EFTA document type ${docType}`;
    }
    // Sectors 0, 1, 2, 3, 4, 7, 9, C
    return CELEX_ACT_TYPES[docType] ?? `Type ${docType}`;
}
function buildHumanReadable(sector, year, docType, docNumber, docTypeDesc, isConsolidated) {
    const num = parseInt(docNumber, 10);
    // Case law: use case number format, not "No X/Year"
    if (sector === "6" || sector === "8") {
        const courtPrefix = docType.startsWith("C") ? "C-" : docType.startsWith("T") ? "T-" : docType.startsWith("F") ? "F-" : "";
        return `${docTypeDesc} in Case ${courtPrefix}${num}/${year}`;
    }
    if (sector === "E") {
        return `${docTypeDesc} — Case E-${num}/${year} (EFTA Court)`;
    }
    const prefix = isConsolidated ? "Consolidated " : "";
    return `${prefix}${docTypeDesc} No ${num}/${year}`;
}
// Normalize CELEX: uppercase, trim
export function normalizeCelex(celex) {
    return celex.trim().toUpperCase();
}
// Check if string looks like a CELEX number (quick regex, not full validation)
export function looksLikeCelex(s) {
    return /^[0-9CE]\d{4}[A-Z]+\d+/i.test(s.trim());
}
//# sourceMappingURL=celex-parser.js.map