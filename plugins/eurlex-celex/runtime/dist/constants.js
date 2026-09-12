// EUR-Lex / CELLAR API endpoints
export const SPARQL_ENDPOINT = "https://publications.europa.eu/webapi/rdf/sparql";
export const CELLAR_BASE = "https://publications.europa.eu/resource/cellar";
export const EURLEX_WS_ENDPOINT = "https://eur-lex.europa.eu/EURLexWebService?wsdl";
export const EURLEX_BASE = "https://eur-lex.europa.eu";
// SPARQL prefixes used in all queries
export const SPARQL_PREFIXES = `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dc: <http://purl.org/dc/elements/1.1/>
PREFIX dct: <http://purl.org/dc/terms/>
`;
// Cache TTLs (ms) — defaults tuned for a server with ≥8 GB free RAM.
// Legal documents are essentially immutable once published, so long TTLs are safe.
// Override via env vars if needed.
export const TTL_METADATA = parseInt(process.env.CACHE_TTL_METADATA ?? "604800") * 1000; // 7 days
export const TTL_CONTENT = parseInt(process.env.CACHE_TTL_CONTENT ?? "86400") * 1000; // 24 h
export const TTL_SEARCH = parseInt(process.env.CACHE_TTL_SEARCH ?? "3600") * 1000; // 1 h
export const TTL_VERSIONS = parseInt(process.env.CACHE_TTL_VERSIONS ?? "604800") * 1000; // 7 days
export const TTL_LANGS = parseInt(process.env.CACHE_TTL_LANGS ?? "604800") * 1000; // 7 days
export const CACHE_MAX = parseInt(process.env.CACHE_MAX_ITEMS ?? "5000");
// EUR-Lex Web Service: registered daily call limit
export const WS_DAILY_LIMIT = parseInt(process.env.EURLEX_WS_DAILY_LIMIT ?? "1000");
export const EXPORT_DIR = process.env.EXPORT_DIR ?? "./exports";
export const CACHE_DIR = process.env.CACHE_DIR ?? "./cache";
export const CHARACTER_LIMIT = 40_000;
// CELEX sector descriptions
export const CELEX_SECTORS = {
    "0": "Consolidated legislation",
    "1": "Treaties",
    "2": "International agreements",
    "3": "Acts of institutions",
    "4": "Internal agreements",
    "5": "Preparatory acts",
    "6": "EU case law",
    "7": "National transposition measures",
    "8": "National case law",
    "9": "Parliamentary questions",
    "C": "Other documents published in the Official Journal C series",
    "E": "EFTA documents",
};
// Document type codes — Sector 3 / 0 (Acts of institutions & Consolidated)
export const CELEX_ACT_TYPES = {
    "R": "Regulation",
    "L": "Directive",
    "D": "Decision",
    "H": "Recommendation",
    "F": "Framework Decision",
    "G": "Resolution",
    "B": "Budget",
    "Q": "Rules of Procedure",
    "S": "ECSC Recommendation",
    "K": "ECSC Decision",
    "A": "Internal Agreement",
    "M": "Non-opposition to notified concentration",
    "X": "Other act",
    "C": "Communication",
    "E": "Council common position",
    "I": "Interinstitutional Agreement",
    "J": "Opinion of an institution",
    "N": "Action plan",
    "P": "Codecision procedure common position",
    "PC": "Proposal (Commission)",
    "DC": "Commission document (COM)",
    "SC": "Commission staff working document (SWD)",
    "AC": "Act adopted under codecision",
};
// Document type codes — Sector 6 (EU Case Law)
export const CELEX_CASE_LAW_TYPES = {
    // Court of Justice of the EU (CJEU)
    "CJ": "Judgment of the Court of Justice",
    "CO": "Order of the Court of Justice",
    "CC": "Opinion of the Advocate-General",
    "CS": "Seizure (Court of Justice)",
    "CT": "Third party proceeding (Court of Justice)",
    "CV": "Opinion of the Court of Justice",
    "CX": "Ruling of the Court of Justice",
    "CD": "Decision of the Court of Justice",
    "CP": "View (Court of Justice)",
    "CN": "Communication: new case (Court of Justice)",
    "CA": "Communication: judgment (Court of Justice)",
    "CB": "Communication: order (Court of Justice)",
    "CU": "Communication: request for opinion",
    "CG": "Communication: opinion (Court of Justice)",
    // General Court (formerly Court of First Instance)
    "TJ": "Judgment of the General Court",
    "TO": "Order of the General Court",
    "TC": "Opinion of the Advocate-General (General Court)",
    "TT": "Third party proceeding (General Court)",
    "TN": "Communication: new case (General Court)",
    "TA": "Communication: judgment (General Court)",
    "TB": "Communication: order (General Court)",
    // Civil Service Tribunal
    "FJ": "Judgment of the Civil Service Tribunal",
    "FO": "Order of the Civil Service Tribunal",
    "FT": "Third party proceeding (Civil Service Tribunal)",
    "FN": "Communication: new case (Civil Service Tribunal)",
    "FA": "Communication: judgment (Civil Service Tribunal)",
    "FB": "Communication: order (Civil Service Tribunal)",
};
// Document type codes — Sector 5 (Preparatory acts)
export const CELEX_PREP_TYPES = {
    "PC": "Proposal for Council act",
    "SC": "Commission staff working document",
    "DC": "Commission document",
    "AC": "Act adopted under codecision",
    "AG": "Preparatory act (General)",
};
// Sector E (EFTA documents)
export const CELEX_EFTA_TYPES = {
    "J": "Decision, order or consultative opinion of the EFTA Court",
    "P": "Pending case of the EFTA Court",
};
// Map from ISO 639-1 (2-letter) to EUR-Lex authority alpha-3 language codes
// Used for SPARQL queries against the CELLAR triplestore
export const LANG_AUTHORITY = {
    "bg": "bul", "cs": "ces", "da": "dan", "de": "deu", "el": "ell",
    "en": "eng", "es": "spa", "et": "est", "fi": "fin", "fr": "fra",
    "ga": "gle", "hr": "hrv", "hu": "hun", "it": "ita", "lt": "lit",
    "lv": "lav", "mt": "mlt", "nl": "nld", "pl": "pol", "pt": "por",
    "ro": "ron", "sk": "slk", "sl": "slv", "sv": "swe"
};
// Reverse map: EUR-Lex authority alpha-3 → ISO 639-1 (2-letter)
export const LANG_AUTHORITY_REVERSE = Object.fromEntries(Object.entries(LANG_AUTHORITY).map(([k, v]) => [v, k]));
// Legacy flat map for backward compatibility
export const CELEX_DOC_TYPES = {
    ...CELEX_ACT_TYPES,
    ...CELEX_CASE_LAW_TYPES,
    ...CELEX_PREP_TYPES,
    ...CELEX_EFTA_TYPES,
};
// Supported languages
export const SUPPORTED_LANGUAGES = [
    "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr",
    "ga", "hr", "hu", "it", "lt", "lv", "mt", "nl", "pl", "pt",
    "ro", "sk", "sl", "sv"
];
//# sourceMappingURL=constants.js.map