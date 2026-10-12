import TurndownService from "turndown";
import fs from "fs";
import path from "path";
import { cacheGet, cacheSet } from "./cache.js";
import { normalizeCelex } from "./celex-parser.js";
import { SPARQL_ENDPOINT, SPARQL_PREFIXES, TTL_METADATA, TTL_CONTENT, TTL_SEARCH, TTL_VERSIONS, TTL_LANGS, EXPORT_DIR, WS_DAILY_LIMIT, LANG_AUTHORITY, LANG_AUTHORITY_REVERSE } from "./constants.js";
// ─── EUR-Lex Web Service daily usage tracker ─────────────────────────────────
// The registered limit is WS_DAILY_LIMIT requests/day (default 1000).
// Resets at midnight UTC. Counter is in-memory only (acceptable: resets with server).
let _wsCalls = 0;
let _wsResetDay = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
function _refreshWsDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== _wsResetDay) {
        _wsCalls = 0;
        _wsResetDay = today;
    }
}
/** Throws if the daily WS limit has been reached. */
export function assertWsLimit() {
    _refreshWsDay();
    if (_wsCalls >= WS_DAILY_LIMIT) {
        throw new Error(`EUR-Lex Web Service daily limit reached (${WS_DAILY_LIMIT} req/day). ` +
            `Resets at midnight UTC (${_wsResetDay}T24:00:00Z).`);
    }
    _wsCalls++;
}
/** Returns current WS usage stats for the status endpoint. */
export function getWsUsage() {
    _refreshWsDay();
    // Next midnight UTC
    const tomorrow = new Date(_wsResetDay);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return {
        used: _wsCalls,
        limit: WS_DAILY_LIMIT,
        remaining: Math.max(0, WS_DAILY_LIMIT - _wsCalls),
        resets_utc: tomorrow.toISOString().slice(0, 10) + "T00:00:00Z",
    };
}
const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
});
// ─── SPARQL helpers ─────────────────────────────────────────────────────────
async function sparqlQuery(query) {
    const fullQuery = SPARQL_PREFIXES + "\n" + query;
    const url = new URL(SPARQL_ENDPOINT);
    url.searchParams.set("query", fullQuery);
    url.searchParams.set("format", "application/sparql-results+json");
    const response = await fetch(url.toString(), {
        headers: { "Accept": "application/sparql-results+json" },
        signal: AbortSignal.timeout(55_000),
    });
    if (!response.ok) {
        throw new Error(`SPARQL query failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.results?.bindings ?? [];
}
function sparqlValue(binding, key) {
    return binding[key]?.value;
}
const parseSparqlBoolean = (value) => value === "true" || value === "1" ? true : value === "false" || value === "0" ? false : undefined;
const LANG_URI = (alpha3) => `<http://publications.europa.eu/resource/authority/language/${alpha3.toUpperCase()}>`;
/**
 * SPARQL fragment binding Official Journal data for work variable ?{w}.
 * Two structures exist in CELLAR: the classic OJ issue (until Sept 2023: "OJ L 119, 4.5.2016")
 * and the act-by-act OJ (from Oct 2023: "OJ L, 2024/1689, 12.7.2024").
 */
const ojFragment = (w) => `
  OPTIONAL {
    ?${w} cdm:resource_legal_published_in_official-journal ?${w}Oj .
    OPTIONAL { ?${w}Oj cdm:official-journal_part_of_collection_document ?${w}OjColl }
    OPTIONAL { ?${w}Oj cdm:official-journal_number ?${w}OjNum }
    OPTIONAL { ?${w}Oj cdm:publication_general_date_publication ?${w}OjDate }
  }
  OPTIONAL { ?${w} cdm:official-journal-act_part_of_collection_document ?${w}ActColl }
  OPTIONAL { ?${w} cdm:resource_legal_reference_oj-act ?${w}ActRef }
  OPTIONAL { ?${w} cdm:official-journal-act_date_publication ?${w}ActDate }`;
/** Aggregate projections for ojFragment (use with GROUP BY). */
const ojProjection = (w) => ["OjColl", "OjNum", "OjDate", "ActColl", "ActRef", "ActDate"]
    .map(f => `(SAMPLE(?${w}${f}) AS ?${w}${f})`).join(" ");
const formatDayMonthYear = (iso) => {
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`;
};
const ojSeries = (collectionUri) => collectionUri?.split("/").pop()?.replace(/^OJ-/, "");
/** Builds a human-readable OJ citation from ojFragment bindings; undefined if CELLAR has none. */
export function formatOjReference(b, w) {
    const actRef = sparqlValue(b, `${w}ActRef`);
    const actDate = sparqlValue(b, `${w}ActDate`);
    if (actRef) {
        const series = ojSeries(sparqlValue(b, `${w}ActColl`)) ?? "L";
        return {
            ojReference: `OJ ${series}, ${actRef}${actDate ? `, ${formatDayMonthYear(actDate)}` : ""}`,
            datePublication: actDate?.slice(0, 10),
        };
    }
    const num = sparqlValue(b, `${w}OjNum`);
    const date = sparqlValue(b, `${w}OjDate`);
    const series = ojSeries(sparqlValue(b, `${w}OjColl`));
    if (series && num) {
        return {
            ojReference: `OJ ${series} ${parseInt(num, 10)}${date ? `, ${formatDayMonthYear(date)}` : ""}`,
            datePublication: date?.slice(0, 10),
        };
    }
    return { datePublication: (date ?? actDate)?.slice(0, 10) };
}
// ─── Metadata ────────────────────────────────────────────────────────────────
export async function getMetadata(celex) {
    const normalized = normalizeCelex(celex);
    const key = `metadata:v3:${normalized}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    // One aggregated row per work. Titles live on the language expressions, not on the work.
    const query = `
SELECT ?work (SAMPLE(?docType) AS ?docType) (MIN(?dateDoc) AS ?dateDoc) (SAMPLE(?inForce) AS ?inForce)
       (SAMPLE(?eli) AS ?eli) (SAMPLE(?titleEn) AS ?titleEn) (SAMPLE(?titleSk) AS ?titleSk)
       (SAMPLE(?titleWork) AS ?titleWork) ${ojProjection("work")}
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  OPTIONAL {
    ?expEn cdm:expression_belongs_to_work ?work ;
           cdm:expression_uses_language ${LANG_URI("ENG")} ;
           cdm:expression_title ?titleEn .
  }
  OPTIONAL {
    ?expSk cdm:expression_belongs_to_work ?work ;
           cdm:expression_uses_language ${LANG_URI("SLK")} ;
           cdm:expression_title ?titleSk .
  }
  OPTIONAL { ?work cdm:work_title ?titleWork }
  OPTIONAL { ?work cdm:resource_legal_type ?docType }
  OPTIONAL { ?work cdm:work_date_document ?dateDoc }
  OPTIONAL { ?work cdm:resource_legal_in-force ?inForce }
  OPTIONAL { ?work cdm:resource_legal_eli ?eli }
  ${ojFragment("work")}
}
GROUP BY ?work
`;
    const bindings = await sparqlQuery(query);
    if (!bindings.length)
        return null;
    const b = bindings[0];
    const titleEn = sparqlValue(b, "titleEn");
    const titleSk = sparqlValue(b, "titleSk");
    const titleWork = sparqlValue(b, "titleWork");
    const title = titleEn ?? titleSk ?? titleWork;
    const titleLang = titleEn ? "en" : titleSk ? "sk" : undefined;
    const oj = formatOjReference(b, "work");
    const metadata = {
        celexNumber: normalized,
        cellarId: sparqlValue(b, "work")?.split("/").pop(),
        title,
        titleLang,
        documentType: sparqlValue(b, "docType"),
        dateDocument: sparqlValue(b, "dateDoc"),
        datePublication: oj.datePublication,
        ojReference: oj.ojReference,
        inForce: parseSparqlBoolean(sparqlValue(b, "inForce")),
        eli: sparqlValue(b, "eli"),
    };
    cacheSet(key, metadata, TTL_METADATA);
    return metadata;
}
// ─── Available languages ──────────────────────────────────────────────────────
export async function getAvailableLanguages(celex) {
    const key = `langs:${celex}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    const normalized = normalizeCelex(celex);
    const query = `
SELECT DISTINCT ?lang
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  ?exp cdm:expression_belongs_to_work ?work .
  ?exp cdm:expression_uses_language ?langCode .
  BIND(STR(?langCode) AS ?lang)
}
ORDER BY ?lang
`;
    const bindings = await sparqlQuery(query);
    const langs = bindings
        .map(b => sparqlValue(b, "lang"))
        .filter((l) => !!l)
        .map(l => {
        const raw = l.split("/").pop()?.toLowerCase() ?? l.toLowerCase();
        // Map EUR-Lex alpha-3 authority codes (slk, eng, deu…) to ISO 639-1 (sk, en, de…)
        return LANG_AUTHORITY_REVERSE[raw] ?? raw;
    });
    const unique = [...new Set(langs)];
    cacheSet(key, unique, TTL_LANGS);
    return unique;
}
// ─── Document versions ────────────────────────────────────────────────────────
export async function getDocumentVersions(celex) {
    const normalized = normalizeCelex(celex);
    const key = `versions:v2:${normalized}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    // Works that amend, correct or consolidate this act (all point TO the act in CELLAR).
    // Works without a CELEX number (internal CONSLEG layers, do_not_index) are skipped.
    const query = `
SELECT ?relType ?relCelex (MIN(?relDate) AS ?relDate) (MIN(?relEffect) AS ?relEffect)
       (SAMPLE(?relTitle) AS ?relTitle) ${ojProjection("rel")}
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  {
    ?rel cdm:resource_legal_amends_resource_legal ?work .
    BIND("amendment" AS ?relType)
    OPTIONAL { ?rel cdm:resource_legal_date_entry-into-force ?relEffect }
  } UNION {
    ?rel cdm:resource_legal_corrects_resource_legal ?work .
    BIND("corrigendum" AS ?relType)
  } UNION {
    # Consolidated texts OF this act (consolidates_resource_legal also links texts of other
    # acts that merely incorporate this one, e.g. 95/46 consolidated with GDPR's repeal).
    ?rel cdm:act_consolidated_based_on_resource_legal ?work .
    BIND("consolidated" AS ?relType)
    OPTIONAL { ?rel cdm:act_consolidated_date ?relEffect }
  }
  ?rel cdm:resource_legal_id_celex ?relCelex .
  OPTIONAL { ?rel cdm:work_date_document ?relDate }
  OPTIONAL {
    ?relExp cdm:expression_belongs_to_work ?rel ;
            cdm:expression_uses_language ${LANG_URI("ENG")} ;
            cdm:expression_title ?relTitle .
  }
  ${ojFragment("rel")}
}
GROUP BY ?relType ?relCelex
ORDER BY ?relType ?relDate ?relCelex
LIMIT 500
`;
    const bindings = await sparqlQuery(query);
    // Include the original document itself
    const origMeta = await getMetadata(normalized);
    const versions = [];
    if (origMeta) {
        versions.push({
            celexNumber: normalized,
            type: "original",
            dateDocument: origMeta.dateDocument,
            ojReference: origMeta.ojReference,
            title: origMeta.title,
        });
    }
    for (const b of bindings) {
        const relCelex = sparqlValue(b, "relCelex");
        const relType = sparqlValue(b, "relType");
        if (!relCelex || (relType !== "amendment" && relType !== "corrigendum" && relType !== "consolidated"))
            continue;
        versions.push({
            celexNumber: relCelex,
            type: relType,
            dateDocument: sparqlValue(b, "relDate"),
            dateEffect: sparqlValue(b, "relEffect"),
            ojReference: formatOjReference(b, "rel").ojReference,
            title: sparqlValue(b, "relTitle"),
        });
    }
    cacheSet(key, versions, TTL_VERSIONS);
    return versions;
}
// ─── Related documents ────────────────────────────────────────────────────────
export const RELATIONSHIPS = [
    "cites", "cited_by", "amends", "amended_by", "transposes", "transposed_by", "repeals", "repealed_by",
];
// CELLAR predicates per relationship, written from the base act ?work to the related ?rel.
// "cites" keeps its historical tool name but means "legal basis" (based_on), not a plain citation.
const RELATIONSHIP_PATTERNS = {
    cites: "?work cdm:resource_legal_based_on_resource_legal ?rel .",
    cited_by: "?rel cdm:resource_legal_based_on_resource_legal ?work .",
    amends: "?work cdm:resource_legal_amends_resource_legal ?rel .",
    amended_by: "?rel cdm:resource_legal_amends_resource_legal ?work .",
    transposes: "{ ?work cdm:measure_national_implementing_implements_resource_legal ?rel } UNION { ?work cdm:measure_national_implementing_implements_directive ?rel }",
    transposed_by: "{ ?rel cdm:measure_national_implementing_implements_resource_legal ?work } UNION { ?rel cdm:measure_national_implementing_implements_directive ?work }",
    repeals: "{ ?work cdm:resource_legal_repeals_resource_legal ?rel } UNION { ?work cdm:resource_legal_implicitly_repeals_resource_legal ?rel . BIND(true AS ?implicit) }",
    repealed_by: "{ ?rel cdm:resource_legal_repeals_resource_legal ?work } UNION { ?rel cdm:resource_legal_implicitly_repeals_resource_legal ?work . BIND(true AS ?implicit) }",
};
/** A national measure carries one CELEX per implemented directive; prefer the one for this act. */
const pickCelex = (celexes, baseCelex) => celexes.find(c => c.startsWith(`7${baseCelex.slice(1)}`)) ?? celexes.sort()[0];
export async function findRelatedDocuments(celex, relationship = "all", limit = 20) {
    const normalized = normalizeCelex(celex);
    const key = `related:v2:${normalized}:${relationship}:${limit}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    const wanted = relationship === "all" ? [...RELATIONSHIPS] : [relationship];
    // 1) Count per relationship, so truncation is visible to the caller.
    const countQuery = `
SELECT ?relationship (COUNT(DISTINCT ?rel) AS ?n)
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  ${wanted.map(r => `{ ${RELATIONSHIP_PATTERNS[r]} BIND("${r}" AS ?relationship) }`).join(" UNION ")}
  ?rel cdm:resource_legal_id_celex ?anyCelex .
}
GROUP BY ?relationship
`;
    const countRows = await sparqlQuery(countQuery);
    const totals = {};
    for (const r of countRows) {
        const rel = sparqlValue(r, "relationship");
        if (rel)
            totals[rel] = parseInt(sparqlValue(r, "n") ?? "0", 10);
    }
    // 2) Fetch up to `limit` works per non-empty relationship (filter applied before LIMIT).
    const perRelationship = await Promise.all(wanted.filter(r => (totals[r] ?? 0) > 0).map(async (r) => {
        const query = `
SELECT ?rel (GROUP_CONCAT(DISTINCT ?c; separator="|") AS ?celexes) (MIN(?d) AS ?relDate)
       (SAMPLE(?tEn) AS ?titleEn) (SAMPLE(?tWork) AS ?titleWork) (SAMPLE(?implicit) AS ?implicit)
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  ${RELATIONSHIP_PATTERNS[r]}
  ?rel cdm:resource_legal_id_celex ?c .
  OPTIONAL { ?rel cdm:work_date_document ?d }
  OPTIONAL {
    ?relExp cdm:expression_belongs_to_work ?rel ;
            cdm:expression_uses_language ${LANG_URI("ENG")} ;
            cdm:expression_title ?tEn .
  }
  OPTIONAL { ?rel cdm:work_title ?tWork }
}
GROUP BY ?rel
ORDER BY DESC(?relDate) ?rel
LIMIT ${limit}
`;
        const rows = await sparqlQuery(query);
        return rows.flatMap((b) => {
            const relCelex = pickCelex((sparqlValue(b, "celexes") ?? "").split("|").filter(Boolean), normalized);
            if (!relCelex)
                return [];
            const implicit = sparqlValue(b, "implicit");
            return [{
                    celexNumber: relCelex,
                    relationship: r,
                    title: sparqlValue(b, "titleEn") ?? sparqlValue(b, "titleWork"),
                    dateDocument: sparqlValue(b, "relDate"),
                    ...(implicit === "true" || implicit === "1" ? { note: "implicit repeal (as recorded in CELLAR)" } : {}),
                }];
        });
    }));
    // Round-robin so that one large relationship (e.g. 88 acts based on GDPR) does not hide the others.
    const documents = [];
    for (let i = 0; documents.length < limit && perRelationship.some(list => i < list.length); i++) {
        for (const list of perRelationship) {
            if (i < list.length && documents.length < limit)
                documents.push(list[i]);
        }
    }
    const totalAvailable = Object.values(totals).reduce((sum, n) => sum + (n ?? 0), 0);
    const result = { documents, totals, truncated: totalAvailable > documents.length };
    cacheSet(key, result, TTL_METADATA);
    return result;
}
/** Backwards-compatible wrapper returning only the documents. */
export async function getRelatedDocuments(celex, limit = 20) {
    return (await findRelatedDocuments(celex, "all", limit)).documents;
}
// ─── ELI resolve ─────────────────────────────────────────────────────────────
// CELLAR stores the ELI as an xsd:anyURI literal in cdm:resource_legal_eli
// (e.g. "http://data.europa.eu/eli/reg/2016/679/oj"); owl:sameAs only carries the
// http://publications.europa.eu/resource/eli/... alias.
/** Normalizes the accepted ELI spellings to the canonical http://data.europa.eu/eli/... form. */
export function normalizeEli(eli) {
    const trimmed = eli.trim().replace(/\/+$/, "");
    const match = trimmed.match(/^https?:\/\/(?:data\.europa\.eu\/eli|publications\.europa\.eu\/resource\/eli)\/([A-Za-z0-9_\-./]+)$/);
    return match ? `http://data.europa.eu/eli/${match[1]}` : null;
}
export async function eliToCelex(eli) {
    const canonical = normalizeEli(eli);
    if (!canonical)
        return null;
    const key = `eli2celex:v2:${canonical}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    const query = `
SELECT ?celex
WHERE {
  ?work cdm:resource_legal_eli "${canonical}"^^xsd:anyURI .
  ?work cdm:resource_legal_id_celex ?celex .
}
ORDER BY ?celex
LIMIT 1
`;
    const bindings = await sparqlQuery(query);
    const celex = sparqlValue(bindings[0] ?? {}, "celex") ?? null;
    if (celex)
        cacheSet(key, celex, TTL_METADATA);
    return celex;
}
export async function celexToEli(celex) {
    const normalized = normalizeCelex(celex);
    const key = `celex2eli:v2:${normalized}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    const query = `
SELECT ?eli
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  ?work cdm:resource_legal_eli ?eli .
}
ORDER BY ?eli
LIMIT 1
`;
    const bindings = await sparqlQuery(query);
    const eli = sparqlValue(bindings[0] ?? {}, "eli") ?? null;
    if (eli)
        cacheSet(key, eli, TTL_METADATA);
    return eli;
}
// ─── Citation check (validity at date) ───────────────────────────────────────
/** CELLAR stores "no end of validity" as the sentinel date 9999-12-31. */
export const OPEN_ENDED_VALIDITY = "9999-12-31";
const splitDates = (value) => [...new Set((value ?? "").split(",").map(d => d.trim()).filter(d => /^\d{4}-\d{2}-\d{2}/.test(d)))]
    .map(d => d.slice(0, 10))
    .sort();
export async function checkCitationAtDate(celex, checkDate) {
    const key = `citation:v3:${celex}:${checkDate}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    const normalized = normalizeCelex(celex);
    // Aggregate per work: CELLAR records several entry-into-force dates for phased acts
    // (GDPR 2, AI Act 5). A plain LIMIT 1 would pick an arbitrary one.
    const query = `
SELECT ?work (MIN(?dd) AS ?dateDoc) (GROUP_CONCAT(DISTINCT STR(?de); separator=",") AS ?dateEntryAll)
       (GROUP_CONCAT(DISTINCT STR(?dn); separator=",") AS ?dateEndAll) (SAMPLE(?f) AS ?inForce)
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  OPTIONAL { ?work cdm:work_date_document ?dd }
  OPTIONAL { ?work cdm:resource_legal_date_entry-into-force ?de }
  OPTIONAL { ?work cdm:resource_legal_date_end-of-validity ?dn }
  OPTIONAL { ?work cdm:resource_legal_in-force ?f }
}
GROUP BY ?work
`;
    const bindings = await sparqlQuery(query);
    if (!bindings.length) {
        return {
            celexNumber: normalized,
            checkDate,
            wasValid: null,
            inForceAsOf: null,
            validityStatus: "not_found",
            currentStatus: "not_found",
            note: "Document not found in EUR-Lex (CELLAR returned no work for this CELEX number)",
        };
    }
    const b = bindings[0];
    const dateDoc = sparqlValue(b, "dateDoc");
    const entryDates = splitDates(sparqlValue(b, "dateEntryAll"));
    const endDates = splitDates(sparqlValue(b, "dateEndAll"));
    const inForce = parseSparqlBoolean(sparqlValue(b, "inForce"));
    // The earliest entry-into-force date is the lower bound of validity; later ones
    // usually concern individual provisions (or application dates) and are reported.
    const dateEntry = entryDates[0];
    const laterEntryDates = entryDates.slice(1);
    // Several distinct end dates are ambiguous: only the earliest/latest bound is safe.
    const dateEndMin = endDates[0];
    const dateEndMax = endDates[endDates.length - 1];
    const dateEnd = endDates.length === 1 ? dateEndMin : undefined;
    const isOpenEnded = endDates.length === 1 && dateEndMin === OPEN_ENDED_VALIDITY;
    const isFutureCheck = checkDate > new Date().toISOString().slice(0, 10);
    let wasValid = null;
    let validityStatus = "unknown";
    let note;
    if (dateEntry && checkDate < dateEntry) {
        wasValid = false;
        validityStatus = "not_in_force";
        note = `Document was not in force on ${checkDate}; EUR-Lex records entry into force on ${dateEntry}`;
    }
    else if (dateEndMax && checkDate > dateEndMax) {
        wasValid = false;
        validityStatus = "not_in_force";
        note = `Document was not in force on ${checkDate}; EUR-Lex records the end of validity on ${dateEndMax}`;
    }
    else if (endDates.length > 1 && checkDate > dateEndMin) {
        note = `Validity on ${checkDate} is unknown: EUR-Lex records several end-of-validity dates (${endDates.join(", ")})`;
    }
    else if (isFutureCheck) {
        note = `Validity on ${checkDate} is unknown because current EUR-Lex status cannot establish a future legal state`;
    }
    else if (dateEntry && (dateEnd || inForce === true)) {
        wasValid = true;
        validityStatus = "in_force";
        const endText = isOpenEnded
            ? " and no end of validity"
            : dateEnd ? ` and end-of-validity date ${dateEnd}` : " and current in-force status";
        note = `Document was in force on ${checkDate} based on the EUR-Lex entry-into-force date ${dateEntry}${endText}`;
    }
    else if (dateEntry) {
        note = `Historical validity is unknown. EUR-Lex records entry into force on ${dateEntry}, but returned no usable end-of-validity date and current status does not establish the requested interval`;
    }
    else {
        note = dateDoc
            ? `Historical validity is unknown. Document date ${dateDoc} is not an entry-into-force date, and EUR-Lex did not return a usable entry-into-force date for this result`
            : "Historical validity is unknown because EUR-Lex did not return a usable entry-into-force date for this result";
    }
    if (laterEntryDates.length) {
        note += `. EUR-Lex also records later entry-into-force dates (${laterEntryDates.join(", ")}); some provisions may only have entered into force or applied from those dates`;
    }
    const result = {
        celexNumber: normalized,
        checkDate,
        wasValid,
        inForceAsOf: wasValid,
        validityStatus,
        dateDocument: dateDoc,
        dateEntryIntoForce: dateEntry,
        datesEntryIntoForce: entryDates.length ? entryDates : undefined,
        dateEndValidity: dateEndMin,
        datesEndValidity: endDates.length > 1 ? endDates : undefined,
        currentStatus: inForce === true ? "in_force" : inForce === false ? "not_in_force" : "unknown",
        note,
    };
    cacheSet(key, result, TTL_METADATA);
    return result;
}
// ─── CELLAR manifestation URI lookup ─────────────────────────────────────────
// Resolves CELEX + language + format → manifestation URI at publications.europa.eu
// This avoids the AWS WAF on eur-lex.europa.eu which blocks automated HTML fetching.
// Preferred CELLAR manifestation types per requested format, best first.
const MANIFESTATION_PREFERENCE = {
    html: ["xhtml", "html", "xhtml5"],
    pdf: ["pdfa2a", "pdfa1a", "pdf", "pdfa1b", "pdfx", "pdf1x", "pdfx4", "print"],
    xml: ["fmx4", "xml"],
};
async function getManifestation(celex, lang, format) {
    const normalized = normalizeCelex(celex);
    const cacheKey = `mani:v2:${normalized}:${lang}:${format}`;
    const cached = cacheGet(cacheKey);
    if (cached)
        return cached;
    const langCode = (LANG_AUTHORITY[lang] ?? lang).toUpperCase();
    const query = `
SELECT DISTINCT ?mani ?type
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  ?exp cdm:expression_belongs_to_work ?work ;
       cdm:expression_uses_language ${LANG_URI(langCode)} .
  ?mani cdm:manifestation_manifests_expression ?exp ;
        cdm:manifestation_type ?type .
}
`;
    const bindings = await sparqlQuery(query);
    const candidates = bindings
        .map(b => ({ uri: sparqlValue(b, "mani") ?? "", type: (sparqlValue(b, "type") ?? "").toLowerCase() }))
        .filter(m => m.uri && MANIFESTATION_PREFERENCE[format].includes(m.type))
        .sort((x, y) => MANIFESTATION_PREFERENCE[format].indexOf(x.type) - MANIFESTATION_PREFERENCE[format].indexOf(y.type) ||
        x.uri.localeCompare(y.uri));
    const best = candidates[0] ?? null;
    if (best)
        cacheSet(cacheKey, best, TTL_METADATA);
    return best;
}
async function getManifestationUri(celex, lang, format) {
    return (await getManifestation(celex, lang, format))?.uri ?? null;
}
/**
 * Lists the content streams of a CELLAR manifestation (GET <manifestation>/list).
 * Streams are not always DOC_1 (e.g. the PDF of 31993L0013 is DOC_2), so never guess.
 */
async function listContentStreams(manifestationUri) {
    const response = await fetch(`${manifestationUri}/list`, {
        headers: { "User-Agent": "EUR-Lex MCP Server (legal research)" },
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
        throw new Error(`CELLAR content list failed for ${manifestationUri}: ${response.status} ${response.statusText}`);
    }
    const html = await response.text();
    return [...html.matchAll(/<span class="url">\s*([^<]+?)\s+--&gt;\s+(https?:\/\/[^<\s]+)\s*<\/span>|<span class="url">\s*([^<]+?)\s+-->\s+(https?:\/\/[^<\s]+)\s*<\/span>/g)]
        .map(m => ({ name: (m[1] ?? m[3]).trim(), url: (m[2] ?? m[4]).trim() }));
}
/** Fetches the main HTML/XHTML content stream of a manifestation. */
async function fetchManifestationHtml(manifestationUri, celex, lang) {
    const streams = await listContentStreams(manifestationUri);
    const stream = streams.find(s => /\.x?html?$/i.test(s.name)) ?? streams[0];
    if (!stream) {
        throw new Error(`Failed to fetch document: CELLAR lists no content stream for CELEX ${celex} in language ${lang}.`);
    }
    const response = await fetch(stream.url, {
        headers: { "User-Agent": "EUR-Lex MCP Server (legal research)" },
        signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch document: ${response.status} ${response.statusText}. Check that CELEX ${celex} exists in language ${lang}.`);
    }
    return response.text();
}
// ─── Document content (HTML → Markdown) ──────────────────────────────────────
export async function getDocumentContent(celex, lang = "en", offsetChars = 0, maxChars = 10_000) {
    const key = `content:${celex}:${lang}`;
    let markdown = cacheGet(key);
    if (!markdown) {
        const normalized = normalizeCelex(celex);
        // Resolve HTML manifestation URI via SPARQL (publications.europa.eu/resource/cellar/...)
        // This bypasses the AWS WAF on eur-lex.europa.eu which blocks automated HTML fetching.
        const manifestationUri = await getManifestationUri(normalized, lang, "html");
        if (!manifestationUri) {
            throw new Error(`Failed to fetch document: no HTML manifestation found for CELEX ${celex} in language "${lang}". ` +
                `Use eurlex_document_languages to check available languages.`);
        }
        const html = await fetchManifestationHtml(manifestationUri, celex, lang);
        markdown = turndown.turndown(html);
        markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();
        cacheSet(key, markdown, TTL_CONTENT);
    }
    const totalChars = markdown.length;
    const slice = markdown.substring(offsetChars, offsetChars + maxChars);
    const complete = offsetChars + slice.length >= totalChars;
    const nextOffset = complete ? undefined : offsetChars + slice.length;
    return {
        content: slice,
        totalChars,
        complete,
        nextOffset,
        language: lang,
        format: "markdown",
    };
}
// ─── Document export (PDF/HTML to disk) ──────────────────────────────────────
export async function exportDocument(celex, lang = "en", format = "pdf") {
    const normalized = normalizeCelex(celex);
    // Resolve manifestation via SPARQL to avoid WAF on eur-lex.europa.eu
    const manifestation = await getManifestation(normalized, lang, format);
    if (!manifestation) {
        throw new Error(`Failed to export document ${celex}: EUR-Lex (CELLAR) has no ${format.toUpperCase()} manifestation for language "${lang}". ` +
            `Use eurlex_document_languages to check available languages, or try another format.`);
    }
    // Formex is a multi-file package (act body, annexes, wrapper) — export the whole package as ZIP.
    let downloadUrl;
    let ext;
    let note;
    if (manifestation.type === "fmx4") {
        downloadUrl = `${manifestation.uri}/zip`;
        ext = "zip";
        note = "Formex 4 XML is published as a multi-file package; the complete package was saved as a ZIP archive.";
    }
    else {
        const streams = await listContentStreams(manifestation.uri);
        const pattern = format === "pdf" ? /\.pdf$/i : format === "html" ? /\.x?html?$/i : /\.xml$/i;
        const stream = streams.find(st => pattern.test(st.name)) ?? (streams.length === 1 ? streams[0] : undefined);
        if (!stream) {
            throw new Error(`Failed to export document ${celex} in ${format}: CELLAR manifestation ${manifestation.uri} (${manifestation.type}) ` +
                `lists ${streams.length} content stream(s) and none is a ${format.toUpperCase()} file.`);
        }
        downloadUrl = stream.url;
        ext = format;
    }
    const response = await fetch(downloadUrl, {
        headers: { "User-Agent": "EUR-Lex MCP Server (legal research)" },
        signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
        throw new Error(`Failed to export document ${celex} in ${format}: ${response.status} ${response.statusText} (${downloadUrl})`);
    }
    // Ensure export directory exists
    if (!fs.existsSync(EXPORT_DIR)) {
        fs.mkdirSync(EXPORT_DIR, { recursive: true });
    }
    const fileName = `${normalized.replace(/[^A-Za-z0-9_.\-]/g, "_")}_${lang}.${ext}`;
    const filePath = path.join(EXPORT_DIR, fileName);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return {
        filePath: path.resolve(filePath),
        format,
        celexNumber: normalized,
        language: lang,
        sizeBytes: buffer.byteLength,
        manifestationType: manifestation.type,
        sourceUrl: downloadUrl,
        ...(note ? { note } : {}),
    };
}
// ─── Full-text search (EUR-Lex SOAP Web Service) ────────────────────────────
export async function searchFullText(query, lang = "en", limit = 10, offset = 0) {
    const username = process.env.EURLEX_WS_USERNAME;
    const password = process.env.EURLEX_WS_PASSWORD;
    if (!username || !password) {
        throw new Error("EUR-Lex Web Service credentials not configured. " +
            "Please set EURLEX_WS_USERNAME and EURLEX_WS_PASSWORD in .env. " +
            "Register at: https://eur-lex.europa.eu/content/help/data-reuse/webservice.html");
    }
    // Auto-normalize query: plain CELEX numbers → DN operator, plain keywords → TI ~
    // If query already contains EUR-Lex operators (=, ~, AND, OR) pass as-is
    const hasOperator = /[=~]|(\bAND\b)|(\bOR\b)|(\bNOT\b)/i.test(query);
    let expertQuery = query;
    if (!hasOperator) {
        // Check if it looks like a CELEX number
        if (/^\d[A-Z0-9]{4,}[A-Z]\d+$/i.test(query.trim())) {
            expertQuery = `DN = ${query.trim().toUpperCase()}`;
        }
        else {
            // Plain keywords → title search
            expertQuery = `TI ~ ${query}`;
        }
    }
    const cacheKey = `search:${lang}:${expertQuery}:${limit}:${offset}`;
    const cached = cacheGet(cacheKey);
    if (cached)
        return cached;
    // Check daily WS limit before making a live call
    assertWsLimit();
    // Use SOAP client dynamically to avoid import issues if soap package not installed
    try {
        const soap = await import("soap");
        const client = await soap.createClientAsync("https://eur-lex.europa.eu/EURLexWebService?wsdl", { forceSoap12Headers: true });
        // WS-Security UsernameToken — required by WSDL policy (WssUsernameToken11)
        // EUR-Lex requires PasswordText (plaintext), not PasswordDigest
        client.setSecurity(new soap.WSSecurity(username, password, {
            passwordType: "PasswordText",
            hasTimeStamp: true,
            hasTokenCreated: true,
        }));
        const [result] = await client.doQueryAsync({
            expertQuery: expertQuery,
            page: Math.floor(offset / limit) + 1,
            pageSize: limit,
            // EUR-Lex full-text index is primarily English — always search in EN
            // for consistent keyword results. Document language is handled separately
            // via eurlex_document_get(lang=...) after finding the CELEX number.
            searchLanguage: "en",
        });
        // Response structure: { numhits, totalhits, page, language, result: [...] }
        const hits = Array.isArray(result?.result)
            ? result.result
            : result?.result ? [result.result] : [];
        const total = parseInt(String(result?.totalhits ?? "0"), 10);
        const results = hits.map((hit) => {
            const notice = hit?.content;
            const work = notice?.NOTICE?.WORK;
            const expr = notice?.NOTICE?.EXPRESSION;
            // Title: nested in EXPRESSION_TITLE.VALUE (may be array for multi-lang)
            const exprTitle = expr?.EXPRESSION_TITLE;
            const titleVal = Array.isArray(exprTitle)
                ? (exprTitle.find((t) => t.LANG === lang.toUpperCase()) ?? exprTitle[0])?.VALUE
                : exprTitle?.VALUE;
            // CELEX: in WORK.SAMEAS[].URI where TYPE === "celex"
            const sameAs = work?.SAMEAS;
            const sameAsArr = Array.isArray(sameAs) ? sameAs : sameAs ? [sameAs] : [];
            const celexEntry = sameAsArr.find((s) => {
                const uri = s?.URI;
                return String(uri?.TYPE ?? "").toLowerCase() === "celex";
            });
            const celexId = celexEntry?.URI?.IDENTIFIER ?? "";
            // Date: WORK_DATE_DOCUMENT is { DAY, MONTH, YEAR, VALUE } — extract VALUE
            const dateRaw = work?.WORK_DATE_DOCUMENT ?? work?.WORK_DATE_ENTRY_INTO_FORCE;
            const dateDoc = typeof dateRaw === "object" && dateRaw !== null
                ? String(dateRaw.VALUE ?? "")
                : String(dateRaw ?? "");
            // Doc type: first entry in WORK.TYPE array (e.g. "cdm:regulation")
            const typeArr = work?.TYPE;
            const rawType = Array.isArray(typeArr) ? typeArr[0] : String(typeArr ?? "");
            const docType = rawType.replace("cdm:", "").replace(/_/g, " ");
            return {
                celexNumber: String(celexId),
                title: String(titleVal ?? hit.reference ?? ""),
                dateDocument: dateDoc,
                documentType: docType,
            };
        });
        const out = { results, total, hasMore: offset + results.length < total };
        cacheSet(cacheKey, out, TTL_SEARCH);
        return out;
    }
    catch (err) {
        throw new Error(`EUR-Lex Web Service search failed: ${err instanceof Error ? err.message : String(err)}. ` +
            "Verify your EURLEX_WS_USERNAME and EURLEX_WS_PASSWORD credentials.");
    }
}
// ─── Document comparison ──────────────────────────────────────────────────────
/** Line-level diff (LCS). Returns unified-style lines: "  " same, "- " only in A, "+ " only in B. */
export function diffLines(a, b) {
    const n = a.length, m = b.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            out.push(`  ${a[i]}`);
            i++;
            j++;
        }
        else if (lcs[i + 1][j] >= lcs[i][j + 1])
            out.push(`- ${a[i++]}`);
        else
            out.push(`+ ${b[j++]}`);
    }
    while (i < n)
        out.push(`- ${a[i++]}`);
    while (j < m)
        out.push(`+ ${b[j++]}`);
    return out;
}
export async function compareDocuments(celexA, langA, celexB, langB, maxChars = 20_000) {
    const [docA, docB] = await Promise.all([
        getDocumentContent(celexA, langA, 0, maxChars),
        getDocumentContent(celexB, langB, 0, maxChars),
    ]);
    const labelA = `${normalizeCelex(celexA)} (${langA})`;
    const labelB = `${normalizeCelex(celexB)} (${langB})`;
    const scope = (d) => `${d.content.length} of ${d.totalChars} chars compared${d.complete ? "" : " (truncated — raise max_chars or compare later windows with eurlex_document_get)"}`;
    const header = [
        `## Comparison: ${labelA} vs ${labelB}`,
        "",
        `**${labelA}**: ${scope(docA)}`,
        `**${labelB}**: ${scope(docB)}`,
        "",
    ];
    if (langA !== langB) {
        // A textual diff across languages is meaningless; show both windows for side-by-side reading.
        return [
            ...header,
            "*Different languages: no automatic diff is computed. Both windows are shown in full for side-by-side reading.*",
            "",
            "### Document A",
            docA.content,
            "",
            "### Document B",
            docB.content,
        ].join("\n");
    }
    const linesA = docA.content.split("\n").map(l => l.trimEnd()).filter(l => l.trim());
    const linesB = docB.content.split("\n").map(l => l.trimEnd()).filter(l => l.trim());
    const diff = diffLines(linesA, linesB);
    const removed = diff.filter(l => l.startsWith("- ")).length;
    const added = diff.filter(l => l.startsWith("+ ")).length;
    // Show only changed lines with one line of context around each change.
    const isChange = (k) => k >= 0 && k < diff.length && !diff[k].startsWith("  ");
    const shown = [];
    let lastShown = -1;
    diff.forEach((line, idx) => {
        if (!(isChange(idx) || isChange(idx - 1) || isChange(idx + 1)))
            return;
        if (lastShown >= 0 && idx > lastShown + 1)
            shown.push("…");
        shown.push(line);
        lastShown = idx;
    });
    return [
        ...header,
        `**Line diff (same language):** ${removed} line(s) only in A, ${added} line(s) only in B, ${diff.length - removed - added} identical.`,
        "",
        removed + added === 0 ? "*No differences in the compared windows.*" : ["```diff", ...shown, "```"].join("\n"),
    ].join("\n");
}
export const MAX_FIND_MATCHES = 200;
export async function findInDocument(celex, lang = "en", query, contextChars = 2_000, maxMatches = 5, useRegex = false) {
    const normalized = normalizeCelex(celex);
    const key = `content:${normalized}:${lang}`;
    // Fetch (or reuse cached) full markdown — identical cache key as getDocumentContent.
    // If the document was already fetched, search is instant (no HTTP round-trip).
    let markdown = cacheGet(key);
    if (!markdown) {
        const manifestationUri = await getManifestationUri(normalized, lang, "html");
        if (!manifestationUri) {
            throw new Error(`Failed to fetch document: no HTML manifestation found for CELEX ${celex} in language "${lang}". ` +
                `Use eurlex_document_languages to check available languages.`);
        }
        const html = await fetchManifestationHtml(manifestationUri, celex, lang);
        markdown = turndown.turndown(html);
        markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();
        cacheSet(key, markdown, TTL_CONTENT);
    }
    const totalChars = markdown.length;
    // Collect all match positions (cap at 200 for safety)
    const positions = [];
    if (useRegex) {
        try {
            const re = new RegExp(query, "gi");
            let m;
            while ((m = re.exec(markdown)) !== null) {
                positions.push(m.index);
                if (positions.length > MAX_FIND_MATCHES)
                    break;
            }
        }
        catch {
            throw new Error(`Invalid regular expression: "${query}"`);
        }
    }
    else {
        const lower = markdown.toLowerCase();
        const lowerQ = query.toLowerCase();
        let pos = 0;
        while (true) {
            const idx = lower.indexOf(lowerQ, pos);
            if (idx === -1)
                break;
            positions.push(idx);
            pos = idx + lowerQ.length;
            if (positions.length > MAX_FIND_MATCHES)
                break;
        }
    }
    // One extra match is collected to detect that the cap was reached.
    const matchCountCapped = positions.length > MAX_FIND_MATCHES;
    if (matchCountCapped)
        positions.length = MAX_FIND_MATCHES;
    const matchCount = positions.length;
    const half = Math.floor(contextChars / 2);
    const matches = positions.slice(0, maxMatches).map((pos, i) => {
        const start = Math.max(0, pos - half);
        const end = Math.min(totalChars, pos + half);
        const lineNumber = markdown.substring(0, pos).split("\n").length;
        return {
            index: i,
            position: pos,
            excerpt: markdown.substring(start, end),
            lineNumber,
        };
    });
    return {
        celex: normalized,
        language: lang,
        query,
        totalChars,
        matchCount,
        matchCountCapped,
        matches,
        truncated: matchCount > maxMatches,
    };
}
//# sourceMappingURL=eurlex-client.js.map