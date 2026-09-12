import { RuMcpError, } from "./types.js";
import { BlockList, isIP } from "node:net";
const DEFAULT_BASE = "https://replik.justice.sk/ru-verejnost-web";
const HOME_PATH = "/";
const SEARCH_PATH = "/pages/searchKonanie.xhtml";
const DETAIL_PATH = "/pages/konanieDetail.xhtml";
const USER_AGENT = "register-upadcov-mcp/0.1";
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_QUERY_BYTES = 256;
const MAX_UPSTREAM_CONCURRENCY = 4;
const ACCEPTED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml", "application/xml", "text/xml"]);
let activeUpstreamRequests = 0;
const upstreamWaiters = [];
const prohibitedSourceAddresses = new BlockList();
for (const [address, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
])
    prohibitedSourceAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
    ["5f00::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["fec0::", 10],
    ["ff00::", 8],
])
    prohibitedSourceAddresses.addSubnet(address, prefix, "ipv6");
function ipv4FromMappedIpv6(hostname) {
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(hostname);
    if (!mapped)
        return undefined;
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}
function isProhibitedSourceHost(rawHostname) {
    const hostname = rawHostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost"))
        return true;
    const family = isIP(hostname);
    if (family === 4)
        return prohibitedSourceAddresses.check(hostname, "ipv4");
    if (family === 6) {
        const mappedIpv4 = ipv4FromMappedIpv6(hostname);
        if (mappedIpv4)
            return prohibitedSourceAddresses.check(mappedIpv4, "ipv4");
        return prohibitedSourceAddresses.check(hostname, "ipv6");
    }
    return false;
}
async function withUpstreamSlot(operation) {
    if (activeUpstreamRequests >= MAX_UPSTREAM_CONCURRENCY) {
        await new Promise((resolve) => upstreamWaiters.push(resolve));
    }
    activeUpstreamRequests += 1;
    try {
        return await operation();
    }
    finally {
        activeUpstreamRequests -= 1;
        upstreamWaiters.shift()?.();
    }
}
// ===========================================================================
// Pure parsing helpers (no network) — exercised directly by unit tests.
// ===========================================================================
export function decodeHtmlEntities(s) {
    return s
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, " ");
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function stripTags(html) {
    return decodeHtmlEntities(html
        .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
        .replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}
/**
 * Read the javax.faces.ViewState token from a JSF page. The hidden input has
 * id "j_id1:javax.faces.ViewState:0" (and name "javax.faces.ViewState").
 * Pure: operates on an HTML string. Throws if absent.
 */
export function parseViewState(html) {
    // <input type="hidden" name="javax.faces.ViewState" id="j_id1:javax.faces.ViewState:0" value="...">
    const tagRe = /<input[^>]*name=["']javax\.faces\.ViewState["'][^>]*>/i;
    const tag = tagRe.exec(html)?.[0];
    if (tag) {
        const m = /value=["']([\s\S]*?)["']/i.exec(tag);
        if (m)
            return decodeHtmlEntities(m[1]);
    }
    // Partial-response form: <update id="...javax.faces.ViewState...">..CDATA..</update>
    const upd = /<update id=["'][^"']*javax\.faces\.ViewState[^"']*["']>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/update>/i.exec(html);
    if (upd)
        return decodeHtmlEntities(upd[1].trim());
    throw new Error("Nepodarilo sa získať javax.faces.ViewState z RU stránky (zlyhala session/handshake alebo zmena stránky?).");
}
/**
 * Discover the auto-generated id of the search-box "type" select inside
 * searchBoxForm (Mojarra generates e.g. searchBoxForm:j_idt61). Pure.
 * Returns the field name (without "_input") or null if not found.
 */
export function discoverSearchBoxTypeField(html) {
    const m = /name=["'](searchBoxForm:j_idt\d+)_input["']/i.exec(html);
    return m ? m[1] : null;
}
/** Read the selected search type value, e.g. KONANIE, from the generated select. */
export function discoverSearchBoxTypeValue(html, field) {
    const selectRe = new RegExp(`<select[^>]*name=["']${escapeRegExp(field)}_input["'][^>]*>([\\s\\S]*?)<\\/select>`, "i");
    const select = selectRe.exec(html)?.[1];
    if (!select)
        return null;
    const selected = /<option[^>]*value=["']([^"']+)["'][^>]*selected=["']selected["'][^>]*>/i.exec(select);
    if (selected)
        return decodeHtmlEntities(selected[1]);
    const first = /<option[^>]*value=["']([^"']+)["'][^>]*>/i.exec(select);
    return first ? decodeHtmlEntities(first[1]) : null;
}
/**
 * Extract the CDATA payload of the konanieList partial-AJAX update.
 * Pure. Returns the inner HTML (the <li> rows) or the input unchanged if it is
 * already plain row HTML.
 */
export function extractKonanieListCdata(xml) {
    const re = /<update id=["']searchKonanieForm:konanieList["']>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/update>/i;
    const m = re.exec(xml);
    return m ? m[1] : xml;
}
/** Parse 'Počet výsledkov: N' out of a search page / partial response. Pure. */
export function parsePocetVysledkov(html) {
    const text = decodeHtmlEntities(html.replace(/<!\[CDATA\[|\]\]>/g, " ").replace(/<[^>]*>/g, "\n"));
    const m = /Po[čc]et v[ýy]sledkov\s*:?\s*([0-9]+(?:[^\S\r\n]+[0-9]{3})*)/i.exec(text);
    if (!m)
        return null;
    const n = parseInt(m[1].replace(/\s+/g, ""), 10);
    return Number.isFinite(n) ? n : null;
}
const DETAIL_BASE = `${DEFAULT_BASE}${DETAIL_PATH}`;
/**
 * Parse the konanieList rows (the CDATA-wrapped <li> blocks of the partial
 * render) into structured search rows. Pure: operates on an HTML string.
 *
 * Row anchor shape:
 *   <a ... href="/ru-verejnost-web/pages/konanieDetail.xhtml?konanieId=NNN&amp;back=true" ...>
 *     Surname Name (DD.MM.YYYY) - <type> - Konkurz č. <spZn></a>
 * PO rows carry "IČO: NNNNNNNN" instead of a birthdate.
 */
export function parseSearchRows(html, baseUrl = DEFAULT_BASE) {
    const body = extractKonanieListCdata(html);
    const rows = [];
    const anchorRe = /<a[^>]*href=["']([^"']*konanieDetail\.xhtml\?[^"']*konanieId=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = anchorRe.exec(body)) !== null) {
        const href = decodeHtmlEntities(m[1]);
        const konanieId = parseKonanieId(href);
        if (!konanieId)
            continue;
        const label = stripTags(m[2]);
        const parsed = parseRowLabel(label);
        // The trustee may appear in a sibling <div class="spravca">Správca: ...</div>.
        // Stop at the next row (<li) so we don't pull the following row's trustee.
        let after = body.slice(anchorRe.lastIndex, anchorRe.lastIndex + 600);
        const nextLi = after.search(/<li[\s>]/i);
        if (nextLi >= 0)
            after = after.slice(0, nextLi);
        const spravca = /Spr[áa]vca\s*:?\s*([^<]+)/i.exec(stripTags(after))?.[1]?.trim() ?? null;
        rows.push({
            konanieId,
            debtorName: parsed.debtorName,
            birthDate: parsed.birthDate,
            ico: parsed.ico,
            subjectType: parsed.subjectType,
            proceedingType: parsed.proceedingType,
            spisovaZnacka: parsed.spisovaZnacka,
            spravca: spravca && spravca.length > 0 ? spravca : null,
            detailUrl: `${baseUrl}${DETAIL_PATH}?konanieId=${konanieId}`,
        });
    }
    return rows;
}
/**
 * Parse the single-line row label, e.g.
 *   "Pongóová Angelika (24.12.1987) - Oddlženie - Konkurz č. 1OdK/134/2026"
 *   "ACME s.r.o. (IČO: 12345678) - Konkurz - Konkurz č. 2K/10/2026"
 * Pure.
 */
export function parseRowLabel(label) {
    const clean = label.replace(/\s+/g, " ").trim();
    // Case number after "č." (handles "Konkurz č." / "č.").
    const spisovaZnacka = /[čc]\.\s*([^\s][^-]*?)\s*$/i.exec(clean)?.[1]?.trim() ?? "";
    // Parenthetical: birthdate (FO) or "IČO: NNN" (PO).
    const paren = /\(([^)]*)\)/.exec(clean)?.[1]?.trim() ?? "";
    let birthDate = null;
    let ico = null;
    let subjectType = "PO";
    const dateM = /^(\d{1,2}\.\d{1,2}\.\d{4})$/.exec(paren);
    const icoM = /I[ČC]O\s*:?\s*(\d{6,8})/i.exec(paren);
    if (dateM) {
        birthDate = dateM[1];
        subjectType = "FO";
    }
    else if (icoM) {
        ico = icoM[1];
        subjectType = "PO";
    }
    // Debtor name = everything before the first "(" or " - ".
    const nameCut = clean.search(/\s*[(]|\s+-\s+/);
    const debtorName = (nameCut >= 0 ? clean.slice(0, nameCut) : clean).trim();
    // Proceeding type = the segment between the parenthetical/name and "... č.".
    // The label tail is "<doc> č. <spZn>" (e.g. "Konkurz č. 1OdK/134/2026"); the
    // proceeding type is everything before that trailing "<word> č." marker.
    const afterParen = paren ? clean.slice(clean.indexOf(")") + 1) : clean.slice(debtorName.length);
    let seg = afterParen.replace(/^\s*-\s*/, "");
    // Cut the trailing case-number marker " č. <spZn>" (keep the proceeding type,
    // whose last word is the document type, e.g. "Oddlženie - Konkurz").
    const cn = /\s+[čc]\.\s*\S/i.exec(seg);
    if (cn)
        seg = seg.slice(0, cn.index);
    let proceedingType = seg.replace(/\s*-\s*$/, "").trim();
    return { debtorName, birthDate, ico, subjectType, proceedingType, spisovaZnacka };
}
export function parseKonanieId(s) {
    const m = /konanieId=(\d+)/i.exec(s);
    return m ? parseInt(m[1], 10) : 0;
}
// ---------------------------------------------------------------------------
// Case-detail parsing
// ---------------------------------------------------------------------------
/**
 * Parse the konanieDetail.xhtml page into a structured case record. The page
 * uses labelled fields; we flatten tags to text and read each label. Pure:
 * operates on an HTML string.
 */
export function parseCaseDetail(html, konanieId, baseUrl = DEFAULT_BASE) {
    const flat = flattenToText(html);
    const knownLabels = [
        "Spisová značka, typ konania",
        "Súd",
        "Sudca",
        "Správca",
        "Stav konania",
        "Posledný verejný oznam",
        "História stavov konania",
        "Navrhovatelia",
        "Návrh na vyhlásenie konkurzu",
        "Lehoty",
        "Typ konania podľa územnej platnosti",
    ];
    const labelValue = (label) => {
        const htmlValue = labelValueFromHtml(html, label, knownLabels);
        if (htmlValue)
            return htmlValue;
        // "Label: value" up to the next " | " separator or end.
        const re = new RegExp(`${escapeRegExp(label)}\\s*:?\\s*([^|]+?)(?:\\s*\\||$)`, "i");
        const m = re.exec(flat);
        return m ? m[1].trim() : null;
    };
    // Spisová značka, typ konania: "1OdK/134/2026, Oddlženie - Konkurz"
    const spisTyp = labelValue("Spisová značka, typ konania");
    let spisovaZnacka = null;
    let typKonania = null;
    if (spisTyp) {
        const ci = spisTyp.indexOf(",");
        if (ci >= 0) {
            spisovaZnacka = spisTyp.slice(0, ci).trim();
            typKonania = spisTyp.slice(ci + 1).trim();
        }
        else {
            spisovaZnacka = spisTyp.trim();
        }
    }
    const detailHeader = parseDetailHeader(html);
    // Subject type token "(FO)" / "(PO)" in the debtor header.
    const subjectType = (detailHeader.subjectType ?? /\((FO|PO)\)/.exec(flat)?.[1]);
    // Debtor: header "(FO) Name (24.12.1987) Address" or "(PO) Name IČO: NNN".
    const upadca = detailHeader.upadca ?? parseDebtor(flat, subjectType ?? null);
    // Súd: "Okresný súd X, odvolací súd Krajský súd v Y"
    const sudRaw = labelValue("Súd");
    let sud = null;
    let odvolaciSud = null;
    if (sudRaw) {
        const om = /odvolac[ií]\s+s[úu]d\s+(.+)$/i.exec(sudRaw);
        if (om) {
            odvolaciSud = om[1].trim();
            sud = sudRaw.slice(0, om.index).replace(/[,\s]+$/, "").trim();
        }
        else {
            sud = sudRaw.trim();
        }
    }
    const sudca = labelValue("Sudca");
    // Správca: "Hellenbart ... k.s. od 09.06.2026"
    const spravcaRaw = labelValue("Správca");
    let spravca = null;
    if (spravcaRaw) {
        const od = /\sod\s+(\d{1,2}\.\d{1,2}\.\d{4})\s*$/i.exec(spravcaRaw);
        spravca = {
            nazov: (od ? spravcaRaw.slice(0, od.index) : spravcaRaw).trim(),
            odDatumu: od ? od[1] : null,
        };
    }
    // Stav konania: "09.06.2026 - Vyhlásený konkurz"
    const stavKonania = parseStav(labelValue("Stav konania"));
    // Posledný verejný oznam: "08.06.2026 - Uznesenie"
    const oznamRaw = labelValue("Posledný verejný oznam");
    let poslednyVerejnyOznam = null;
    if (oznamRaw) {
        const s = parseStav(oznamRaw);
        poslednyVerejnyOznam = s ? { datum: s.datum, typ: s.stav } : { datum: null, typ: oznamRaw };
    }
    // História stavov konania: "09.06.2026 - X; 02.06.2026 - Y"
    const historiaRaw = labelValue("História stavov konania");
    const historiaStavov = parseStavList(historiaRaw);
    // Navrhovatelia: comma-list of one or more proposers (split on ";").
    const navrhRaw = labelValue("Navrhovatelia");
    const navrhovatelia = navrhRaw
        ? navrhRaw.split(";").map((x) => x.trim()).filter((x) => x.length > 0)
        : [];
    const lehotyRaw = labelValue("Lehoty");
    const lehoty = lehotyRaw
        ? lehotyRaw.split(";").map((x) => x.trim()).filter((x) => x.length > 0)
        : [];
    const typPodlaUzemnejPlatnosti = labelValue("Typ konania podľa územnej platnosti");
    return {
        konanieId,
        spisovaZnacka,
        typKonania,
        subjectType: subjectType ?? null,
        upadca,
        sud,
        odvolaciSud,
        sudca,
        spravca,
        stavKonania,
        historiaStavov,
        poslednyVerejnyOznam,
        navrhovatelia,
        lehoty,
        typPodlaUzemnejPlatnosti,
        tabCounts: parseTabCounts(flat),
        detailUrl: `${baseUrl}${DETAIL_PATH}?konanieId=${konanieId}`,
    };
}
function labelValueFromHtml(html, label, labels) {
    const labelRe = new RegExp(`${escapeRegExp(label)}\\s*:`, "i");
    const labelMatch = labelRe.exec(html);
    if (!labelMatch)
        return null;
    const start = labelMatch.index;
    const afterStart = start + labelMatch[0].length;
    let end = html.length;
    for (const nextLabel of labels) {
        if (nextLabel === label)
            continue;
        const nextRe = new RegExp(`${escapeRegExp(nextLabel)}\\s*:`, "i");
        const nextMatch = nextRe.exec(html.slice(afterStart));
        if (nextMatch && afterStart + nextMatch.index < end) {
            end = afterStart + nextMatch.index;
        }
    }
    const block = html.slice(start, end);
    const text = stripTags(block)
        .replace(new RegExp(`^${escapeRegExp(label)}\\s*:?\\s*`, "i"), "")
        .split(/\s*\|\s*/)[0]
        .replace(/\s+,/g, ",")
        .trim();
    return text.length > 0 ? text : null;
}
function parseDetailHeader(html) {
    const m = /<div[^>]*class=["'][^"']*\bdetail\b[^"']*["'][^>]*>[\s\S]*?<h1[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>[\s\S]*?<\/h1>[\s\S]*?<h2[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i.exec(html);
    if (!m)
        return { subjectType: null, upadca: null };
    const title = stripTags(m[1]).replace(/\s+,/g, ",").trim();
    const address = stripTags(m[2]).replace(/\s+,/g, ",").trim() || null;
    const subjectType = /\((FO|PO)\)/.exec(title)?.[1];
    const birth = /\((\d{1,2}\.\d{1,2}\.\d{4})\)/.exec(title);
    const ico = /I[ČC]O\s*:?\s*(\d{6,8})/i.exec(title)?.[1] ?? null;
    const meno = title
        .replace(/^\((?:FO|PO)\)\s*/i, "")
        .replace(/\(\d{1,2}\.\d{1,2}\.\d{4}\)/, "")
        .replace(/I[ČC]O\s*:?\s*\d{6,8}/i, "")
        .trim();
    return {
        subjectType: subjectType ?? null,
        upadca: {
            meno,
            datumNarodenia: birth ? birth[1] : null,
            ico,
            adresa: address,
        },
    };
}
function parseStav(raw) {
    if (!raw)
        return null;
    const m = /^(\d{1,2}\.\d{1,2}\.\d{4})\s*-\s*(.+)$/.exec(raw.trim());
    if (m)
        return { datum: m[1], stav: m[2].trim() };
    return { datum: null, stav: raw.trim() };
}
function parseStavList(raw) {
    if (!raw)
        return [];
    const normalized = raw.replace(/\s+/g, " ").trim();
    if (normalized.includes(";")) {
        return normalized
            .split(";")
            .map((part) => parseStav(part.trim()))
            .filter((stav) => stav !== null);
    }
    const matches = Array.from(normalized.matchAll(/(\d{1,2}\.\d{1,2}\.\d{4})\s*-\s*/g));
    if (matches.length === 0)
        return [];
    return matches.map((match, i) => {
        const valueStart = match.index + match[0].length;
        const valueEnd = matches[i + 1]?.index ?? normalized.length;
        return {
            datum: match[1],
            stav: normalized.slice(valueStart, valueEnd).trim(),
        };
    });
}
function parseDebtor(flat, subjectType) {
    // Header up to the first " | " separator (the "Spisová značka..." block).
    const head = flat.split("|")[0] ?? flat;
    // Strip the leading "<type> č. <spZn> (FO)" prefix.
    const afterType = head.replace(/^[\s\S]*?\((?:FO|PO)\)\s*/i, "");
    const birth = /\((\d{1,2}\.\d{1,2}\.\d{4})\)/.exec(afterType);
    const ico = /I[ČC]O\s*:?\s*(\d{6,8})/i.exec(afterType)?.[1] ?? null;
    let meno = afterType;
    if (birth)
        meno = afterType.slice(0, birth.index).trim();
    else if (ico)
        meno = afterType.slice(0, afterType.search(/I[ČC]O/i)).trim();
    // Address: everything after the birthdate/IČO token, comma-joined.
    let adresa = null;
    const tailStart = birth
        ? birth.index + birth[0].length
        : ico
            ? afterType.search(/I[ČC]O/i)
            : -1;
    if (tailStart >= 0) {
        adresa = afterType.slice(tailStart).replace(/^\s*I[ČC]O\s*:?\s*\d{6,8}\s*/i, "").trim();
        adresa = adresa.replace(/\s*,\s*/g, ", ").replace(/^[,\s]+|[,\s]+$/g, "").trim();
        if (adresa.length === 0)
            adresa = null;
    }
    return {
        meno: meno.trim(),
        datumNarodenia: birth ? birth[1] : null,
        ico,
        adresa,
    };
}
function parseTabCounts(flat) {
    const count = (label) => {
        const re = new RegExp(`${escapeRegExp(label)}\\s*\\(?\\s*(\\d+)\\s*\\)?`, "i");
        const m = re.exec(flat);
        return m ? parseInt(m[1], 10) : null;
    };
    return {
        verejneOznamy: count("Verejné oznamy"),
        pohladavky: count("Pohľadávky"),
        ppp: count("PPP"),
        majetok: count("Majetok"),
        podstaty: count("Podstaty"),
        schodze: count("Schôdze"),
        veritelia: count("Veritelia"),
    };
}
/** Flatten HTML to a single normalized text line, preserving "|" hints. */
function flattenToText(html) {
    return decodeHtmlEntities(html
        .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
        .replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .replace(/\s+,/g, ",")
        .trim();
}
// ===========================================================================
// Cookie jar helper (session handshake)
// ===========================================================================
function mergeSetCookie(jar, setCookie) {
    if (!setCookie)
        return;
    // Node fetch joins multiple Set-Cookie with ", " — split on cookie boundaries.
    for (const part of setCookie.split(/,(?=\s*[A-Za-z0-9_\-]+=)/)) {
        const kv = part.split(";")[0].trim();
        const eq = kv.indexOf("=");
        if (eq > 0)
            jar.set(kv.slice(0, eq), kv.slice(eq + 1));
    }
}
function cookieHeader(jar) {
    return Array.from(jar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
}
// ===========================================================================
// Client
// ===========================================================================
export class RuClient {
    base;
    fetchImpl;
    timeoutMs;
    origin;
    basePath;
    constructor(opts = {}) {
        // `??` would only fall through on null/undefined. Deployment passes
        // RU_BASE_URL: "${RU_BASE_URL:-}", so the variable arrives SET BUT EMPTY —
        // an empty base made every request resolve to fetch("/") and the server
        // answered "Failed to parse URL from /". Treat blank as absent.
        const envBase = process.env.RU_BASE_URL?.trim();
        const base = opts.baseUrl?.trim() || envBase || DEFAULT_BASE;
        this.base = base.replace(/\/$/, "");
        let parsed;
        try {
            parsed = new URL(this.base);
        }
        catch {
            throw new RuMcpError("RU_SOURCE_REDIRECT", "RU source base is invalid.");
        }
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
            throw new RuMcpError("RU_SOURCE_REDIRECT", "RU source base is unsafe.");
        }
        if (isProhibitedSourceHost(parsed.hostname)) {
            throw new RuMcpError("RU_SOURCE_REDIRECT", "RU source base is unsafe.");
        }
        this.origin = parsed.origin;
        this.basePath = parsed.pathname.replace(/\/$/, "");
        this.fetchImpl = opts.fetchImpl ?? fetch;
        this.timeoutMs = opts.timeoutMs ?? 30000;
    }
    async withTimeout(fn) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
        try {
            return await fn(ctrl.signal);
        }
        catch (error) {
            if (error instanceof RuMcpError)
                throw error;
            if (ctrl.signal.aborted || error?.name === "AbortError") {
                throw new RuMcpError("RU_SOURCE_TIMEOUT", "RU source request timed out.");
            }
            throw new RuMcpError("RU_SOURCE_HTTP", "RU source request failed.");
        }
        finally {
            clearTimeout(t);
        }
    }
    validateUrl(raw) {
        let url;
        try {
            url = new URL(raw, this.origin);
        }
        catch {
            throw new RuMcpError("RU_SOURCE_REDIRECT", "RU source URL is invalid.");
        }
        const approved = new Set([
            `${this.basePath}/`,
            `${this.basePath}${SEARCH_PATH}`,
            `${this.basePath}${DETAIL_PATH}`,
        ]);
        if (url.origin !== this.origin || url.username || url.password || url.hash || !approved.has(url.pathname)) {
            throw new RuMcpError("RU_SOURCE_REDIRECT", "RU source URL left the approved boundary.");
        }
        return url;
    }
    async readBounded(res) {
        const declared = Number(res.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)
            throw new RuMcpError("RU_SOURCE_SIZE", "RU source response is too large.");
        if (!res.body)
            return "";
        const reader = res.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.byteLength;
            if (total > MAX_RESPONSE_BYTES) {
                await reader.cancel().catch(() => undefined);
                throw new RuMcpError("RU_SOURCE_SIZE", "RU source response is too large.");
            }
            chunks.push(value);
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return new TextDecoder().decode(bytes);
    }
    async requestText(url, init, allowSearchPostRedirect = false, jar) {
        return this.withTimeout(async (signal) => {
            return withUpstreamSlot(async () => {
                const target = this.validateUrl(url);
                const perform = (next, request) => this.fetchImpl(next.href, { ...request, redirect: "manual", signal });
                let res = await perform(target, init);
                if (jar)
                    mergeSetCookie(jar, res.headers.get("set-cookie"));
                if (res.status >= 300 && res.status < 400) {
                    if (!allowSearchPostRedirect || init.method !== "POST" || (res.status !== 302 && res.status !== 303)) {
                        throw new RuMcpError("RU_SOURCE_REDIRECT", "RU source redirect was rejected.");
                    }
                    const location = res.headers.get("location");
                    if (!location)
                        throw new RuMcpError("RU_SOURCE_REDIRECT", "RU source redirect was rejected.");
                    const redirected = this.validateUrl(new URL(location, target).href);
                    if (redirected.pathname !== `${this.basePath}${SEARCH_PATH}`) {
                        throw new RuMcpError("RU_SOURCE_REDIRECT", "RU source redirect was rejected.");
                    }
                    await res.body?.cancel().catch(() => undefined);
                    res = await perform(redirected, { method: "GET", headers: init.headers });
                    if (jar)
                        mergeSetCookie(jar, res.headers.get("set-cookie"));
                    if (res.status >= 300 && res.status < 400)
                        throw new RuMcpError("RU_SOURCE_REDIRECT", "RU source redirect chain was rejected.");
                }
                if (res.status !== 200)
                    throw new RuMcpError("RU_SOURCE_HTTP", `RU source returned HTTP ${res.status}.`);
                const contentType = (res.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
                if (!ACCEPTED_CONTENT_TYPES.has(contentType))
                    throw new RuMcpError("RU_SOURCE_CONTENT_TYPE", "RU source content type was rejected.");
                return this.readBounded(res);
            });
        });
    }
    requireSearchStructure(html) {
        if (!/name=["']javax\.faces\.ViewState["']/i.test(html) || !html.includes("searchKonanieForm:konanieList")) {
            throw new RuMcpError("RU_SOURCE_PARSE", "RU search structure was not recognized.");
        }
    }
    /**
     * Mandatory session handshake: GET the homepage to obtain the JSESSIONID
     * cookie (scoped to /ru-verejnost-web). Without it every deep request is
     * 302-redirected back to the homepage. Returns a cookie jar.
     */
    async handshake(jar) {
        const html = await this.requestText(`${this.base}${HOME_PATH}`, {
            method: "GET",
            headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        }, false, jar);
        void html;
    }
    /**
     * ru_search: handshake → GET searchKonanie (harvest ViewState) → POST the
     * full-text query → POST partial-AJAX render of konanieList → parse the rows.
     */
    async search(params) {
        const query = params.query.trim();
        if (!query)
            throw new RuMcpError("RU_INPUT", "RU query is required.");
        if (Buffer.byteLength(query, "utf8") > MAX_QUERY_BYTES)
            throw new RuMcpError("RU_INPUT_TOO_LARGE", "RU query is too large.");
        const page = params.page ?? 0;
        const pageSize = params.pageSize ?? 15;
        const first = page * pageSize;
        const jar = new Map();
        await this.handshake(jar);
        // 1) GET the search page to harvest a fresh ViewState + the search-box ids.
        const formHtml = await this.requestText(`${this.base}${SEARCH_PATH}`, {
            method: "GET",
            headers: { "User-Agent": USER_AGENT, Accept: "text/html", Cookie: cookieHeader(jar) },
        }, false, jar);
        this.requireSearchStructure(formHtml);
        let viewState;
        try {
            viewState = parseViewState(formHtml);
        }
        catch {
            throw new RuMcpError("RU_SOURCE_PARSE", "RU search state was not recognized.");
        }
        const typeField = discoverSearchBoxTypeField(formHtml);
        const typeValue = typeField ? discoverSearchBoxTypeValue(formHtml, typeField) : null;
        // 2) POST the full-text query (non-AJAX Mojarra form submit).
        const queryHtml = await (async () => {
            const body = new URLSearchParams();
            body.set("searchBoxForm", "searchBoxForm");
            body.set("searchBoxForm:searchQuery_input", query);
            body.set("searchBoxForm:search", "searchBoxForm:search");
            if (typeField && typeValue)
                body.set(`${typeField}_input`, typeValue);
            body.set("javax.faces.ViewState", viewState);
            return this.requestText(`${this.base}${SEARCH_PATH}`, {
                method: "POST",
                headers: {
                    "User-Agent": USER_AGENT,
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    Accept: "text/html",
                    Cookie: cookieHeader(jar),
                },
                body: body.toString(),
            }, true, jar);
        })();
        if (/Nenašli\s+sa\s+žiadne\s+konania\s+pre\s+hľadaný\s+reťazec/i.test(stripTags(decodeHtmlEntities(queryHtml)))) {
            try {
                parseViewState(queryHtml);
            }
            catch {
                throw new RuMcpError("RU_SOURCE_PARSE", "RU search state was not recognized.");
            }
            if (!/<form[^>]*id=["']searchKonanieForm["']/i.test(queryHtml)) {
                throw new RuMcpError("RU_SOURCE_PARSE", "RU search structure was not recognized.");
            }
            return { query, page, pageSize, pocetVysledkov: 0, results: [] };
        }
        this.requireSearchStructure(queryHtml);
        // The query POST returns a fresh ViewState; reuse it for the AJAX render.
        try {
            viewState = parseViewState(queryHtml);
        }
        catch {
            /* keep previous ViewState */
        }
        const pocetVysledkov = parsePocetVysledkov(queryHtml);
        // 3) POST the PrimeFaces lazy DataTable partial render for the active query.
        const partialXml = await (async () => {
            const body = new URLSearchParams();
            body.set("javax.faces.partial.ajax", "true");
            body.set("javax.faces.source", "searchKonanieForm:konanieList");
            body.set("javax.faces.partial.execute", "searchKonanieForm:konanieList");
            body.set("javax.faces.partial.render", "searchKonanieForm:konanieList");
            body.set("searchKonanieForm:konanieList", "searchKonanieForm:konanieList");
            body.set("searchKonanieForm:konanieList_pagination", "true");
            body.set("searchKonanieForm:konanieList_first", String(first));
            body.set("searchKonanieForm:konanieList_rows", String(pageSize));
            body.set("searchKonanieForm", "searchKonanieForm");
            body.set("javax.faces.ViewState", viewState);
            return this.requestText(`${this.base}${SEARCH_PATH}`, {
                method: "POST",
                headers: {
                    "User-Agent": USER_AGENT,
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    Accept: "application/xml, text/xml, */*",
                    "Faces-Request": "partial/ajax",
                    "X-Requested-With": "XMLHttpRequest",
                    Cookie: cookieHeader(jar),
                },
                body: body.toString(),
            }, false, jar);
        })();
        if (!/<update\s+id=["']searchKonanieForm:konanieList["']/i.test(partialXml)) {
            throw new RuMcpError("RU_SOURCE_PARSE", "RU result update was not recognized.");
        }
        const results = parseSearchRows(partialXml, this.base).slice(0, pageSize);
        const validatedCount = parsePocetVysledkov(partialXml) ?? pocetVysledkov;
        if (results.length === 0 && validatedCount === null) {
            throw new RuMcpError("RU_SOURCE_PARSE", "RU empty result was not explicitly validated.");
        }
        return {
            query,
            pocetVysledkov: validatedCount,
            page,
            pageSize,
            results,
        };
    }
    /**
     * ru_get_case: GET the case-detail deep link (needs the session cookie) and
     * parse the labelled fields incl. trustee + status + status history.
     */
    async getCase(konanieId) {
        if (!Number.isSafeInteger(konanieId) || konanieId < 1)
            throw new RuMcpError("RU_INPUT", "RU case identifier is invalid.");
        const jar = new Map();
        await this.handshake(jar);
        const url = `${this.base}${DETAIL_PATH}?konanieId=${konanieId}&back=true`;
        const html = await this.requestText(url, {
            method: "GET",
            headers: { "User-Agent": USER_AGENT, Accept: "text/html", Cookie: cookieHeader(jar) },
        }, false, jar);
        const hasId = new RegExp(`konanieId\\s*=\\s*["']?${konanieId}(?:\\D|$)`, "i").test(html);
        const hasLabel = /Spisová značka|Súd|Sudca|Správca|Stav konania|Posledný verejný oznam/i.test(html);
        if (!hasId || !hasLabel)
            throw new RuMcpError("RU_SOURCE_PARSE", "RU case structure was not recognized.");
        return parseCaseDetail(html, konanieId, this.base);
    }
}
