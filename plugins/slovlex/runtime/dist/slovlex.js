import { LRUCache } from "lru-cache";
import * as cheerio from "cheerio";
import { httpGetBinary, httpGetJson, httpGetText } from "./http.js";
import { extractTextFromDocument, getCachedDocumentText } from "./document-text.js";
const API_BASE = "https://api-gateway.slov-lex.sk";
const STATIC_BASE = "https://static.slov-lex.sk/static";
const portalHtmlCache = new LRUCache({
    max: 64,
    ttl: 1000 * 60 * 60 * 6,
});
const rozsireneCache = new LRUCache({
    max: 256,
    ttl: 1000 * 60 * 60 * 24,
});
const searchCache = new LRUCache({
    max: 256,
    ttl: 1000 * 60 * 10,
});
const legislativneMaterialyCache = new LRUCache({
    max: 2,
    ttl: 1000 * 60 * 60 * 6,
});
const legislativnyMaterialDetailCache = new LRUCache({
    max: 256,
    ttl: 1000 * 60 * 60 * 12,
});
const sprievodneDokumentyCache = new LRUCache({
    max: 256,
    ttl: 1000 * 60 * 60 * 3,
});
const extractedReportCache = new LRUCache({ max: 128, ttl: 1000 * 60 * 60 });
function toYyyyMmDd(date) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}
export function parseLawBaseIri(input) {
    const trimmed = input.trim();
    const iriMatch = trimmed.match(/\/?SK\/ZZ\/(\d{4})\/(\d{1,6})/);
    if (iriMatch) {
        const year = iriMatch[1];
        const number = iriMatch[2];
        return { number, year, baseIri: `/SK/ZZ/${year}/${number}` };
    }
    const cisloMatch = trimmed.match(/(\d{1,6})\s*\/\s*(\d{4})/);
    if (cisloMatch) {
        const number = cisloMatch[1];
        const year = cisloMatch[2];
        return { number, year, baseIri: `/SK/ZZ/${year}/${number}` };
    }
    throw new Error(`Neviem parsovať zákon: "${input}". Očakávam napr. "595/2003" alebo "/SK/ZZ/2003/595".`);
}
export async function getRozsireneByCislo(cislo) {
    const cacheKey = `cislo:${cislo}`;
    const cached = rozsireneCache.get(cacheKey);
    if (cached)
        return cached;
    const url = `${API_BASE}/vyhladavanie/predpisZbierky/rozsirene?cislo=${encodeURIComponent(cislo)}`;
    const data = await httpGetJson(url);
    const doc = data.docs?.[0];
    if (!doc)
        throw new Error(`Predpis nenájdený: ${cislo}`);
    rozsireneCache.set(cacheKey, doc);
    return doc;
}
export async function getRozsireneByIri(iri) {
    const cacheKey = `iri:${iri}`;
    const cached = rozsireneCache.get(cacheKey);
    if (cached)
        return cached;
    const url = `${API_BASE}/vyhladavanie/predpisZbierky/rozsirene?iri=${encodeURIComponent(iri)}`;
    const data = await httpGetJson(url);
    const doc = data.docs?.[0];
    if (!doc)
        throw new Error(`Predpis nenájdený (iri): ${iri}`);
    rozsireneCache.set(cacheKey, doc);
    return doc;
}
export async function getVersionIriForDate(baseIri, dateIso) {
    const date = dateIso?.trim() ? dateIso.trim() : toYyyyMmDd(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`Neplatný dátum: "${date}". Očakávam YYYY-MM-DD.`);
    }
    const url = `${API_BASE}/vyhladavanie/predpisZbierky/znenie?` +
        `zodpovedajucaUcinnost=${encodeURIComponent(date)}&predpis=${encodeURIComponent(baseIri)}`;
    const data = await httpGetJson(url);
    const doc = data.docs?.[0];
    if (!doc?.iri)
        throw new Error(`Nenašlo sa znenie pre ${baseIri} k dátumu ${date}.`);
    return { versionIri: doc.iri, date };
}
export async function getPortalHtml(versionIri) {
    const cached = portalHtmlCache.get(versionIri);
    if (cached)
        return cached;
    const url = `${STATIC_BASE}${versionIri}.portal`;
    const html = await httpGetText(url, { headers: { accept: "text/html" } });
    portalHtmlCache.set(versionIri, html);
    return html;
}
export async function searchNavrhy(query, limit) {
    const q = query.trim();
    if (!q)
        return [];
    const key = `navrhy:${q}::${limit}`;
    const cached = searchCache.get(key);
    if (cached)
        return cached;
    const url = `${API_BASE}/vyhladavanie/predpisZbierky/navrhy?` +
        `dopyt=${encodeURIComponent(q)}&rows=${encodeURIComponent(String(limit))}&typ=predpisZbierky`;
    const items = await httpGetJson(url);
    searchCache.set(key, items);
    return items;
}
export async function searchRozsirene(query, limit) {
    const q = query.trim();
    if (!q)
        return [];
    const key = `rozsirene:${q}::${limit}`;
    const cached = searchCache.get(key);
    if (cached)
        return cached;
    const url = `${API_BASE}/vyhladavanie/predpisZbierky/rozsirene?` +
        `text=${encodeURIComponent(q)}&rows=${encodeURIComponent(String(limit))}`;
    const data = await httpGetJson(url);
    const results = data.docs ?? [];
    searchCache.set(key, results);
    return results;
}
function parseLpIdentifier(lpRaw) {
    const trimmed = lpRaw.trim().toUpperCase();
    const match = trimmed.match(/^([A-Z]+)\s*\/\s*(\d{4})\s*\/\s*(\d{1,6})$/);
    if (!match) {
        throw new Error(`Neplatný LP identifikátor: "${lpRaw}". Očakávam formát napr. "LP/2025/50".`);
    }
    const [, type, year, index] = match;
    return { type, year, index, normalized: `${type}/${year}/${index}` };
}
function normalizeForSearch(text) {
    return (text ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}
function parseLawNumberYear(law) {
    const parsed = parseLawBaseIri(law);
    return { number: String(parsed.number), year: String(parsed.year) };
}
function explanatoryCategoryFromName(name) {
    const n = normalizeForSearch(name);
    if (n.includes("vseobec"))
        return "vseobecna";
    if (n.includes("osobit"))
        return "osobitna";
    return "ine";
}
// Boilerplate words that carry no subject meaning in a law title. Dropping them
// leaves the distinctive tokens (e.g. "medzinarodnej", "ochrane") used to match a
// law against its legislative-process (LP) material by subject.
const LAW_TITLE_STOPWORDS = new Set([
    "zakon", "zakona", "zakonom", "navrh", "ktorym", "ktorou", "ktore", "niektore",
    "niektorych", "zakony", "zakonov", "meni", "doplna", "menia", "doplnaju", "zmene",
    "doplneni", "zneni", "neskorsich", "predpisov", "predpis", "vyhlaska", "vyhlasky",
    "nariadenie", "vlady", "slovenskej", "republiky", "uznesenie", "oznamenie",
]);
export function significantTitleTokens(title) {
    return Array.from(new Set(normalizeForSearch(title)
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 4 && !LAW_TITLE_STOPWORDS.has(t))));
}
// Scores how strongly an LP material matches a given law. Combines an exact
// "č. N/RRRR" citation match (amendments of an existing law) with subject-token
// overlap against the law's title (brand-new laws whose LP title never contains
// the future Zbierka number).
export function scoreLpCandidate(lpTitle, lpTypeKod, lawId, lawTitleTokens) {
    const title = normalizeForSearch(lpTitle);
    if (!title)
        return 0;
    const citation = normalizeForSearch(`c. ${lawId}`);
    const lawIdNorm = normalizeForSearch(lawId);
    let score = 0;
    // Strongest signal: amendment titles cite the law as "č. N/RRRR".
    // Weaker fallback: the bare "N/RRRR" appears without the "č." prefix.
    if (title.includes(citation))
        score += 6;
    else if (title.includes(lawIdNorm))
        score += 3;
    if (lawTitleTokens.length) {
        const matched = lawTitleTokens.filter((t) => title.includes(t)).length;
        const ratio = matched / lawTitleTokens.length;
        if (ratio >= 0.9)
            score += 6;
        else if (ratio >= 0.6)
            score += 4;
        else if (ratio >= 0.4)
            score += 2;
    }
    if (score > 0 && lpTypeKod === "Zakon")
        score += 3;
    return score;
}
export function chooseConfidentLpCandidate(candidates) {
    const [top, second] = candidates;
    // Exact subject overlap (6) plus the law material type (3) is the intended
    // strong path for a new law whose future collection number is absent.
    if (!top || top.score < 9)
        return undefined;
    if (second && top.score - second.score < 3)
        return undefined;
    return top;
}
// Picks an explanatory report by requested category, falling back to the first
// available report when the wanted category isn't present (many materials have a
// single combined "Dôvodová správa" rather than split všeobecná/osobitná parts).
export function selectExplanatoryReport(reports, wantedCategory) {
    if (!reports.length)
        return undefined;
    if (wantedCategory === "any")
        return reports[0];
    return reports.find((r) => r.category === wantedCategory) ?? reports[0];
}
function compareByCreatedAtDesc(a, b) {
    const ta = Date.parse(a.createdAt ?? "");
    const tb = Date.parse(b.createdAt ?? "");
    if (Number.isNaN(ta) && Number.isNaN(tb))
        return 0;
    if (Number.isNaN(ta))
        return 1;
    if (Number.isNaN(tb))
        return -1;
    return tb - ta;
}
export async function getLegislativnyMaterialDetailByLp(lp) {
    const parsed = parseLpIdentifier(lp);
    const cacheKey = `detail:${parsed.normalized}`;
    const cached = legislativnyMaterialDetailCache.get(cacheKey);
    if (cached)
        return cached;
    const url = `${API_BASE}/external/elegislativa/legislativne-materialy/` +
        `${encodeURIComponent(parsed.type)}/${encodeURIComponent(parsed.year)}/${encodeURIComponent(parsed.index)}`;
    const detail = await httpGetJson(url);
    if (!detail?.uuid) {
        throw new Error(`Legislatívny proces nenájdený: ${parsed.normalized}`);
    }
    legislativnyMaterialDetailCache.set(cacheKey, detail);
    return detail;
}
export async function getSprievodneDokumentyByMaterialUuid(materialUuid) {
    const cacheKey = `sprievodne:${materialUuid}`;
    const cached = sprievodneDokumentyCache.get(cacheKey);
    if (cached)
        return cached;
    const url = `${API_BASE}/external/evidencna-aplikacia/legislativne-materialy/` +
        `${encodeURIComponent(materialUuid)}/sprievodne-dokumenty`;
    const docs = await httpGetJson(url);
    const out = Array.isArray(docs) ? docs : [];
    sprievodneDokumentyCache.set(cacheKey, out);
    return out;
}
export function buildSprievodnyDokumentDownloadUrl(documentUuid) {
    return (`${API_BASE}/external/evidencna-aplikacia/sprievodne-dokumenty/` +
        `${encodeURIComponent(documentUuid)}/download`);
}
function fileNameFromContentDisposition(contentDisposition) {
    if (!contentDisposition)
        return undefined;
    const utf8 = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8?.[1])
        return decodeURIComponent(utf8[1]);
    const ascii = contentDisposition.match(/filename="([^"]+)"/i) ?? contentDisposition.match(/filename=([^;]+)/i);
    if (ascii?.[1])
        return ascii[1].trim();
    return undefined;
}
export async function getExplanatoryReportsByLp(lp, options = {}) {
    const includeHistory = options.includeHistory ?? false;
    const maxResults = options.maxResults ?? 6;
    const detail = await getLegislativnyMaterialDetailByLp(lp);
    const docs = await getSprievodneDokumentyByMaterialUuid(detail.uuid);
    const explanatory = docs
        .filter((d) => {
        const typeCode = d.typ?.kod ?? "";
        const text = normalizeForSearch(`${d.typ?.nazov ?? ""} ${d.nazov ?? ""}`);
        const isReasonReport = typeCode === "DovodovaSprava" || text.includes("dovodova sprava");
        const isPlaceholder = text.includes("prazdny dokument kvoli slovlexu");
        return isReasonReport && !isPlaceholder;
    })
        .sort(compareByCreatedAtDesc);
    let selected = explanatory;
    if (!includeHistory) {
        const byCategory = new Map();
        for (const doc of explanatory) {
            const key = explanatoryCategoryFromName(doc.nazov);
            if (!byCategory.has(key))
                byCategory.set(key, doc);
        }
        selected = Array.from(byCategory.values()).sort(compareByCreatedAtDesc);
    }
    const trimmed = selected.slice(0, Math.max(1, Math.min(20, maxResults)));
    const reports = trimmed.map((d) => ({
        uuid: d.uuid,
        nazov: d.nazov ?? d.uuid,
        typ: d.typ?.nazov,
        category: explanatoryCategoryFromName(d.nazov),
        stage: d.stadiumMaterialuHistoria?.stadium?.hodnota,
        createdAt: d.createdAt,
        sizeBytes: d.velkost,
        downloadUrl: buildSprievodnyDokumentDownloadUrl(d.uuid),
    }));
    return {
        lp: detail.cisloLegislativnehoMaterialu ??
            parseLpIdentifier(lp).normalized,
        lpUuid: detail.uuid,
        title: detail.nazov,
        reports,
    };
}
export async function extractExplanatoryReportText(documentUuid, options = {}) {
    const maxChars = options.maxChars ?? 20_000;
    const downloadUrl = buildSprievodnyDokumentDownloadUrl(documentUuid);
    const cacheKey = `uuid:${documentUuid}|url:${downloadUrl}`;
    let cached = extractedReportCache.get(cacheKey);
    if (!cached) {
        const binary = await httpGetBinary(downloadUrl);
        const fileName = fileNameFromContentDisposition(binary.contentDisposition);
        const extracted = await getCachedDocumentText(cacheKey, () => extractTextFromDocument(binary.body, { fileName, contentType: binary.contentType }));
        cached = { extracted, fileName, contentType: binary.contentType };
        extractedReportCache.set(cacheKey, cached);
    }
    const { extracted, fileName, contentType } = cached;
    const fullText = extracted.text;
    const offsetChars = Math.max(0, Math.min(options.offsetChars ?? 0, fullText.length));
    const text = fullText.slice(offsetChars, offsetChars + maxChars);
    const returnedChars = text.length;
    const hasMore = offsetChars + returnedChars < fullText.length;
    return {
        documentUuid,
        downloadUrl,
        fileName,
        contentType,
        format: extracted.format,
        text,
        totalChars: fullText.length,
        offsetChars,
        returnedChars,
        hasMore,
    };
}
export async function findLpCandidatesForLaw(law, limit = 5) {
    const { number, year } = parseLawNumberYear(law);
    const lawId = `${number}/${year}`;
    // Fetch the law's official title so we can match LP materials by subject, not
    // only by the Zbierka number. A brand-new law's LP title contains its name
    // (e.g. "Návrh zákona o medzinárodnej ochrane…"), never the future ZZ number.
    let lawTitleTokens = [];
    try {
        const doc = await getRozsireneByCislo(lawId);
        lawTitleTokens = significantTitleTokens(doc.nazov);
    }
    catch {
        // Law metadata not found — fall back to number/citation matching only.
    }
    // The eLegislatíva endpoint ignores query params and returns the full set of
    // current legislative materials, so we fetch once and rank client-side.
    const cacheKey = "list:all";
    let materials = legislativneMaterialyCache.get(cacheKey);
    if (!materials) {
        const url = `${API_BASE}/external/elegislativa/legislativne-materialy`;
        materials = await httpGetJson(url);
        legislativneMaterialyCache.set(cacheKey, materials);
    }
    const scored = (materials ?? [])
        .filter((m) => (m.cisloLegislativnehoMaterialu ?? "").startsWith("LP/"))
        .map((m) => ({
        item: m,
        score: scoreLpCandidate(m.nazov, m.typ?.kod ?? "", lawId, lawTitleTokens),
    }))
        .filter((x) => x.score > 0)
        .sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        return (b.item.zaciatokStadia ?? "").localeCompare(a.item.zaciatokStadia ?? "");
    })
        .slice(0, Math.max(1, Math.min(20, limit)));
    return scored.map((x) => ({
        lp: x.item.cisloLegislativnehoMaterialu ?? "",
        title: x.item.nazov ?? "",
        type: x.item.typ?.nazov ?? "",
        stage: x.item.stadium?.hodnota ?? "",
        score: x.score,
    }));
}
const RSS_URL = "https://vyhladavanie.slov-lex.sk/rss/predpisZbierky";
const recentCache = new LRUCache({
    max: 1,
    ttl: 1000 * 60 * 10, // 10 minút
});
/**
 * Získa posledných 20 vyhlásených predpisov z RSS feedu Slov-Lex.
 * POZOR: RSS feed obsahuje len 20 najnovších položiek, nie kompletný archív.
 */
export async function getRecentPredpisy() {
    const cached = recentCache.get("recent");
    if (cached)
        return cached;
    const xml = await httpGetText(RSS_URL);
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];
    $("item").each((_, el) => {
        const $item = $(el);
        items.push({
            cislo: $item.find("description").text().trim(),
            nazov: $item.find("title").text().trim(),
            link: $item.find("link").text().trim(),
            pubDate: $item.find("pubDate").text().trim(),
            creator: $item.find("dc\\:creator").text().trim() || undefined,
        });
    });
    recentCache.set("recent", items);
    return items;
}
