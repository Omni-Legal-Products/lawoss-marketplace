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
// ─── Metadata ────────────────────────────────────────────────────────────────
export async function getMetadata(celex) {
    const key = `metadata:${celex}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    const normalized = normalizeCelex(celex);
    const query = `
SELECT DISTINCT ?work ?title ?titleLang ?docType ?dateDoc ?datePub ?oj ?inForce ?eli ?sector ?year
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  OPTIONAL {
    ?work cdm:work_title ?title .
    BIND(LANG(?title) AS ?titleLang)
    FILTER(?titleLang = "en" || ?titleLang = "sk" || ?titleLang = "")
  }
  OPTIONAL { ?work cdm:resource_legal_type ?docType }
  OPTIONAL { ?work cdm:work_date_document ?dateDoc }
  OPTIONAL { ?work cdm:work_date_publication ?datePub }
  OPTIONAL { ?work cdm:resource_legal_published_in_official-journal ?oj }
  OPTIONAL { ?work cdm:resource_legal_in-force ?inForce }
  OPTIONAL { ?work owl:sameAs ?eli . FILTER(STRSTARTS(STR(?eli), "http://data.europa.eu/eli/")) }
}
LIMIT 5
`;
    const bindings = await sparqlQuery(query);
    if (!bindings.length)
        return null;
    const b = bindings[0];
    const cellarId = sparqlValue(b, "work")?.split("/").pop();
    const inForceStr = sparqlValue(b, "inForce");
    // Try to get best title (prefer English if multiple rows)
    let title;
    let titleLang;
    for (const binding of bindings) {
        const t = sparqlValue(binding, "title");
        const tl = sparqlValue(binding, "titleLang");
        if (t) {
            title = t;
            titleLang = tl;
            if (tl === "en")
                break;
        }
    }
    const metadata = {
        celexNumber: normalized,
        cellarId,
        title,
        titleLang,
        documentType: sparqlValue(b, "docType"),
        dateDocument: sparqlValue(b, "dateDoc"),
        datePublication: sparqlValue(b, "datePub"),
        ojReference: sparqlValue(b, "oj"),
        inForce: inForceStr === "true",
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
    const key = `versions:${celex}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    const normalized = normalizeCelex(celex);
    // Get amendments, corrigenda, and consolidated versions
    const query = `
SELECT DISTINCT ?relWork ?relCelex ?relType ?relDate ?relOJ ?relTitle
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  {
    ?relWork cdm:resource_legal_amends ?work .
    BIND("amendment" AS ?relType)
  } UNION {
    ?work cdm:resource_legal_amends ?relWork .
    BIND("amended_by" AS ?relType)
  } UNION {
    ?relWork cdm:resource_legal_corrects ?work .
    BIND("corrigendum" AS ?relType)
  } UNION {
    ?relWork cdm:resource_legal_based_on_concept_treaty ?work .
    BIND("consolidated" AS ?relType)
  }
  OPTIONAL { ?relWork cdm:resource_legal_id_celex ?relCelex }
  OPTIONAL { ?relWork cdm:work_date_document ?relDate }
  OPTIONAL { ?relWork cdm:resource_legal_published_in_official-journal ?relOJ }
  OPTIONAL {
    ?relWork cdm:work_title ?relTitle .
    FILTER(LANG(?relTitle) = "en" || LANG(?relTitle) = "")
  }
}
ORDER BY ?relDate
LIMIT 100
`;
    const bindings = await sparqlQuery(query);
    // Include the original document itself
    const origMeta = await getMetadata(celex);
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
        if (!relCelex)
            continue;
        const relTypeRaw = sparqlValue(b, "relType") ?? "amendment";
        let type = "amendment";
        if (relTypeRaw === "corrigendum")
            type = "corrigendum";
        else if (relTypeRaw === "consolidated")
            type = "consolidated";
        versions.push({
            celexNumber: relCelex,
            type,
            dateDocument: sparqlValue(b, "relDate"),
            ojReference: sparqlValue(b, "relOJ"),
            title: sparqlValue(b, "relTitle"),
        });
    }
    cacheSet(key, versions, TTL_VERSIONS);
    return versions;
}
// ─── Related documents ────────────────────────────────────────────────────────
export async function getRelatedDocuments(celex, limit = 20) {
    const key = `related:${celex}:${limit}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    const normalized = normalizeCelex(celex);
    const query = `
SELECT DISTINCT ?relWork ?relCelex ?relationship ?relDate ?relTitle
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  {
    ?work cdm:resource_legal_based_on ?relWork .
    BIND("cites" AS ?relationship)
  } UNION {
    ?relWork cdm:resource_legal_based_on ?work .
    BIND("cited_by" AS ?relationship)
  } UNION {
    ?work cdm:resource_legal_implements ?relWork .
    BIND("transposes" AS ?relationship)
  } UNION {
    ?relWork cdm:resource_legal_implements ?work .
    BIND("transposed_by" AS ?relationship)
  } UNION {
    ?work cdm:resource_legal_repeals ?relWork .
    BIND("repeals" AS ?relationship)
  } UNION {
    ?relWork cdm:resource_legal_repeals ?work .
    BIND("repealed_by" AS ?relationship)
  }
  OPTIONAL { ?relWork cdm:resource_legal_id_celex ?relCelex }
  OPTIONAL { ?relWork cdm:work_date_document ?relDate }
  OPTIONAL {
    ?relWork cdm:work_title ?relTitle .
    FILTER(LANG(?relTitle) = "en" || LANG(?relTitle) = "")
  }
}
ORDER BY ?relationship ?relDate
LIMIT ${limit}
`;
    const bindings = await sparqlQuery(query);
    const docs = bindings
        .filter(b => sparqlValue(b, "relCelex"))
        .map(b => ({
        celexNumber: sparqlValue(b, "relCelex"),
        relationship: (sparqlValue(b, "relationship") ?? "cites"),
        title: sparqlValue(b, "relTitle"),
        dateDocument: sparqlValue(b, "relDate"),
    }));
    cacheSet(key, docs, TTL_METADATA);
    return docs;
}
// ─── ELI resolve ─────────────────────────────────────────────────────────────
export async function eliToCelex(eli) {
    const key = `eli2celex:${eli}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    const query = `
SELECT ?celex
WHERE {
  ?work owl:sameAs <${eli}> .
  ?work cdm:resource_legal_id_celex ?celex .
}
LIMIT 1
`;
    const bindings = await sparqlQuery(query);
    const celex = sparqlValue(bindings[0] ?? {}, "celex") ?? null;
    if (celex)
        cacheSet(key, celex, TTL_METADATA);
    return celex;
}
export async function celexToEli(celex) {
    const key = `celex2eli:${celex}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    const normalized = normalizeCelex(celex);
    const query = `
SELECT ?eli
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  ?work owl:sameAs ?eli .
  FILTER(STRSTARTS(STR(?eli), "http://data.europa.eu/eli/"))
}
LIMIT 1
`;
    const bindings = await sparqlQuery(query);
    const eli = sparqlValue(bindings[0] ?? {}, "eli") ?? null;
    if (eli)
        cacheSet(key, eli, TTL_METADATA);
    return eli;
}
export async function checkCitationAtDate(celex, checkDate) {
    const key = `citation:${celex}:${checkDate}`;
    const cached = cacheGet(key);
    if (cached)
        return cached;
    const normalized = normalizeCelex(celex);
    const query = `
SELECT DISTINCT ?work ?dateDoc ?dateEntry ?dateEnd ?inForce ?consolidated
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  OPTIONAL { ?work cdm:work_date_document ?dateDoc }
  OPTIONAL { ?work cdm:resource_legal_date_entry-into-force ?dateEntry }
  OPTIONAL { ?work cdm:resource_legal_date_end-of-validity ?dateEnd }
  OPTIONAL { ?work cdm:resource_legal_in-force ?inForce }
  OPTIONAL {
    ?consolidated cdm:resource_legal_consolidates ?work .
    ?consolidated cdm:resource_legal_id_celex ?consolidatedCelex .
  }
}
LIMIT 1
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
            note: "Document not found in EUR-Lex database",
        };
    }
    const b = bindings[0];
    const dateDoc = sparqlValue(b, "dateDoc");
    const dateEntry = sparqlValue(b, "dateEntry");
    const dateEnd = sparqlValue(b, "dateEnd");
    const inForce = sparqlValue(b, "inForce");
    const checkDateObj = new Date(checkDate);
    const dateEntryObj = dateEntry ? new Date(dateEntry) : null;
    const dateEndObj = dateEnd ? new Date(dateEnd) : null;
    const hasDateEntry = dateEntryObj !== null && !Number.isNaN(dateEntryObj.getTime());
    const hasDateEnd = dateEndObj !== null && !Number.isNaN(dateEndObj.getTime());
    const isFutureCheck = checkDate > new Date().toISOString().slice(0, 10);
    let wasValid = null;
    let validityStatus = "unknown";
    let note;
    if (hasDateEntry && checkDateObj < dateEntryObj) {
        wasValid = false;
        validityStatus = "not_in_force";
        note = `Document was not in force on ${checkDate}; EUR-Lex records entry into force on ${dateEntry}`;
    }
    else if (hasDateEnd && checkDateObj > dateEndObj) {
        wasValid = false;
        validityStatus = "not_in_force";
        note = `Document was not in force on ${checkDate}; EUR-Lex records the end of validity on ${dateEnd}`;
    }
    else if (isFutureCheck) {
        note = `Validity on ${checkDate} is unknown because current EUR-Lex status cannot establish a future legal state`;
    }
    else if (hasDateEntry && (hasDateEnd || inForce === "true")) {
        wasValid = true;
        validityStatus = "in_force";
        note = `Document was in force on ${checkDate} based on the EUR-Lex entry-into-force date ${dateEntry}${hasDateEnd ? ` and end-of-validity date ${dateEnd}` : " and current in-force status"}`;
    }
    else if (hasDateEntry) {
        note = `Historical validity is unknown. EUR-Lex records entry into force on ${dateEntry}, but returned no usable end-of-validity date and current status does not establish the requested interval`;
    }
    else {
        note = dateDoc
            ? `Historical validity is unknown. Document date ${dateDoc} is not an entry-into-force date, and EUR-Lex did not return a usable entry-into-force date for this result`
            : "Historical validity is unknown because EUR-Lex did not return a usable entry-into-force date for this result";
    }
    const result = {
        celexNumber: normalized,
        checkDate,
        wasValid,
        inForceAsOf: wasValid,
        validityStatus,
        dateDocument: dateDoc,
        dateEntryIntoForce: dateEntry,
        dateEndValidity: dateEnd,
        currentStatus: inForce === "true" ? "in_force" : inForce === "false" ? "not_in_force" : "unknown",
        note,
    };
    cacheSet(key, result, TTL_METADATA);
    return result;
}
// ─── CELLAR manifestation URI lookup ─────────────────────────────────────────
// Resolves CELEX + language + format → manifestation URI at publications.europa.eu
// This avoids the AWS WAF on eur-lex.europa.eu which blocks automated HTML fetching.
async function getManifestationUri(celex, lang, format) {
    const cacheKey = `mani:${celex}:${lang}:${format}`;
    const cached = cacheGet(cacheKey);
    if (cached)
        return cached;
    const normalized = normalizeCelex(celex);
    const langCode = (LANG_AUTHORITY[lang] ?? lang).toLowerCase();
    // For HTML: prefer xhtml (rendered) over fmx4 (Formex XML source)
    const filterExpr = format === "html"
        ? `FILTER(REGEX(LCASE(STR(?formatRes)), "html|xhtml|fmx4", "i"))`
        : format === "pdf"
            ? `FILTER(REGEX(LCASE(STR(?formatRes)), "pdf", "i"))`
            : `FILTER(REGEX(LCASE(STR(?formatRes)), "xml|formex|fmx", "i"))`;
    const orderExpr = format === "html"
        ? `ORDER BY DESC(CONTAINS(LCASE(STR(?formatRes)), "xhtml")) DESC(CONTAINS(LCASE(STR(?formatRes)), "html"))`
        : ``;
    const query = `
SELECT DISTINCT ?mani ?formatRes
WHERE {
  ?work cdm:resource_legal_id_celex "${normalized}"^^xsd:string .
  ?exp cdm:expression_belongs_to_work ?work .
  ?exp cdm:expression_uses_language ?langRes .
  BIND(LCASE(STRAFTER(STR(?langRes), "/language/")) AS ?langCode)
  FILTER(?langCode = "${langCode}")
  ?mani cdm:manifestation_manifests_expression ?exp .
  ?mani cdm:manifestation_type ?formatRes .
  ${filterExpr}
}
${orderExpr}
LIMIT 3
`;
    const bindings = await sparqlQuery(query);
    const uri = sparqlValue(bindings[0] ?? {}, "mani") ?? null;
    if (uri)
        cacheSet(cacheKey, uri, TTL_METADATA);
    return uri;
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
        const response = await fetch(manifestationUri, {
            headers: {
                "Accept": "text/html, application/xhtml+xml",
                "User-Agent": "EUR-Lex MCP Server (legal research)",
            },
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch document: ${response.status} ${response.statusText}. Check that CELEX ${celex} exists in language ${lang}.`);
        }
        const html = await response.text();
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
    const langUp = lang.toUpperCase();
    let mimeType;
    let ext;
    if (format === "pdf") {
        mimeType = "application/pdf";
        ext = "pdf";
    }
    else if (format === "html") {
        mimeType = "text/html";
        ext = "html";
    }
    else {
        mimeType = "application/xml";
        ext = "xml";
    }
    // Resolve manifestation URI via SPARQL to avoid WAF on eur-lex.europa.eu
    const manifestationUri = await getManifestationUri(normalized, lang, format);
    if (!manifestationUri) {
        throw new Error(`Failed to export document ${celex}: no ${format.toUpperCase()} manifestation found for language "${lang}". ` +
            `Use eurlex_document_languages to check available languages.`);
    }
    const response = await fetch(manifestationUri, {
        headers: {
            "Accept": mimeType,
            "User-Agent": "EUR-Lex MCP Server (legal research)",
        },
        signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
        throw new Error(`Failed to export document ${celex} in ${format}: ${response.status} ${response.statusText}`);
    }
    // Ensure export directory exists
    if (!fs.existsSync(EXPORT_DIR)) {
        fs.mkdirSync(EXPORT_DIR, { recursive: true });
    }
    const fileName = `${normalized}_${lang}.${ext}`;
    const filePath = path.join(EXPORT_DIR, fileName);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return {
        filePath: path.resolve(filePath),
        format,
        celexNumber: normalized,
        language: lang,
        sizeBytes: buffer.byteLength,
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
export async function compareDocuments(celexA, langA, celexB, langB, maxChars = 20_000) {
    const [docA, docB] = await Promise.all([
        getDocumentContent(celexA, langA, 0, maxChars),
        getDocumentContent(celexB, langB, 0, maxChars),
    ]);
    // Simple line-based diff representation
    const linesA = docA.content.split("\n");
    const linesB = docB.content.split("\n");
    const labelA = `${celexA} (${langA})`;
    const labelB = `${celexB} (${langB})`;
    // Build diff summary
    const diffLines = [
        `## Comparison: ${labelA} vs ${labelB}`,
        "",
        `**${labelA}**: ${docA.totalChars} chars total${docA.complete ? "" : " (truncated)"}`,
        `**${labelB}**: ${docB.totalChars} chars total${docB.complete ? "" : " (truncated)"}`,
        "",
        "### Document A",
        docA.content.substring(0, 5000),
        "",
        "### Document B",
        docB.content.substring(0, 5000),
        "",
        `---`,
        `*Note: For detailed diff analysis, use document_get on each document separately with offset/max_chars parameters.*`,
    ];
    return diffLines.join("\n");
}
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
        const response = await fetch(manifestationUri, {
            headers: {
                "Accept": "text/html, application/xhtml+xml",
                "User-Agent": "EUR-Lex MCP Server (legal research)",
            },
            signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch document: ${response.status} ${response.statusText}. ` +
                `Check that CELEX ${celex} exists in language ${lang}.`);
        }
        const html = await response.text();
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
                if (positions.length >= 200)
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
            if (positions.length >= 200)
                break;
        }
    }
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
        matches,
        truncated: matchCount > maxMatches,
    };
}
//# sourceMappingURL=eurlex-client.js.map