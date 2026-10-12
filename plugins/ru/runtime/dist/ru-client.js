import { RuMcpError, } from "./types.js";
import { BlockList, isIP } from "node:net";
const DEFAULT_BASE = "https://replik.justice.sk/ru-verejnost-web";
const HOME_PATH = "/";
const SEARCH_PATH = "/pages/searchKonanie.xhtml";
const DETAIL_PATH = "/pages/konanieDetail.xhtml";
const USER_AGENT = "register-upadcov-mcp/0.2";
/** The register renders a fixed 15 rows per search page. */
const SOURCE_PAGE_SIZE = 15;
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
 * Parse the result total out of a search page. The current page renders
 * `Počet výsledkov: <span id="…:total" class="highlight">1212</span>`; the
 * number sits inside a tag, so tags are stripped before matching (ported from
 * the LAWOSS release, d8a3a47). Pure. Returns null when no total is shown.
 */
export function parsePocetVysledkov(html) {
    const text = decodeHtmlEntities(html.replace(/<!\[CDATA\[|\]\]>/g, " ").replace(/<[^>]*>/g, "\n"));
    const m = /Po[čc]et v[ýy]sledkov\s*:?\s*([0-9]+(?:[^\S\r\n]+[0-9]{3})*)/i.exec(text);
    if (!m)
        return null;
    const n = parseInt(m[1].replace(/\s+/g, ""), 10);
    return Number.isFinite(n) ? n : null;
}
/** True when the source explicitly answered that nothing matched the query. Pure. */
export function isNoResultsPage(html) {
    return /Nenašli\s+sa\s+žiadne\s+konania/i.test(stripTags(html));
}
/** Current page number from the "N/M" page marker, or null when the marker is absent. Pure. */
export function parseCurrentPage(html) {
    const m = /oznacenieStranky["'][^>]*>\s*<span[^>]*>\s*(\d+)\s*\/\s*\d+/i.exec(html);
    return m ? parseInt(m[1], 10) : null;
}
/** Text of an inline fragment: inline emphasis joins without a space ("<em>s.r.o</em>." → "s.r.o."). */
function inlineText(html) {
    return stripTags(html.replace(/<\/?(?:em|strong|b|i)\b[^>]*>/gi, ""));
}
/** "--" is how the register prints a missing value. */
function nullIfDash(s) {
    const t = (s ?? "").trim();
    return t.length === 0 || /^-+$/.test(t) ? null : t;
}
/**
 * Parse the result rows of a search page. Each row is an
 * `<li class="mspacerTop pt10 pb10">` with a heading link
 * ("Name (IČO: N) - Konkurz č. 2K/10/2026") followed by `div.row` blocks:
 * status | date, court; "Posledný oznam vo VO:"; "Správca:" or "Likvidátor:".
 * Pure: operates on an HTML string.
 */
export function parseSearchRows(html, baseUrl = DEFAULT_BASE, prebiehajuce = null) {
    const rows = [];
    const blocks = html.split(/<li\s+class=["']mspacerTop pt10 pb10["'][^>]*>/i).slice(1);
    for (const raw of blocks) {
        const block = raw.split(/<\/li>/i)[0];
        const anchor = /<a[^>]*href=["']([^"']*konanieDetail\.xhtml\?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i.exec(block);
        if (!anchor)
            continue;
        const konanieId = parseKonanieId(decodeHtmlEntities(anchor[1]));
        if (!konanieId)
            continue;
        const parsed = parseRowLabel(inlineText(anchor[2]));
        let stav = null;
        let stavDatum = null;
        let sud = null;
        let poslednyOznamVo = null;
        let spravca = null;
        let likvidator = null;
        const cellRe = /<div\s+class=["']col-xs-3["'][^>]*>([\s\S]*?)<\/div>\s*<div\s+class=["']col-xs-9[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
        let cell;
        while ((cell = cellRe.exec(block)) !== null) {
            const label = inlineText(cell[1]);
            const value = inlineText(cell[2]);
            if (/^Posledn[ýy] oznam/i.test(label)) {
                const m = /^(\d{1,2}\.\d{1,2}\.\d{4})\s*(?:-\s*(.*))?$/.exec(value);
                poslednyOznamVo = m
                    ? { datum: m[1], typ: nullIfDash(m[2]) }
                    : value
                        ? { datum: null, typ: value }
                        : null;
            }
            else if (/^Spr[áa]vca\s*:/i.test(label)) {
                spravca = nullIfDash(value);
            }
            else if (/^Likvid[áa]tor\s*:/i.test(label)) {
                likvidator = nullIfDash(value);
            }
            else if (!label.endsWith(":") && stav === null) {
                // Status row: "<stav>" | "<date or -->, <court>".
                stav = nullIfDash(label);
                const ci = value.indexOf(",");
                stavDatum = nullIfDash(ci >= 0 ? value.slice(0, ci) : value);
                sud = ci >= 0 ? nullIfDash(value.slice(ci + 1)) : null;
            }
        }
        rows.push({
            konanieId,
            debtorName: parsed.debtorName,
            birthDate: parsed.birthDate,
            ico: parsed.ico,
            subjectType: parsed.subjectType,
            proceedingType: parsed.proceedingType,
            spisovaZnacka: parsed.spisovaZnacka,
            stav,
            stavDatum,
            sud,
            poslednyOznamVo,
            spravca,
            likvidator,
            prebiehajuce,
            detailUrl: `${baseUrl}${DETAIL_PATH}?konanieId=${konanieId}`,
        });
    }
    return rows;
}
/**
 * Parse the single-line row label, e.g.
 *   "Pongóová Angelika (24.12.1987) - Oddlženie - Konkurz č. 1OdK/134/2026"
 *   "ACME s.r.o. (IČO: 12345678) - Konkurz - Konkurz č. 2K/10/2026"
 *   "\"v konkurze\" SLATUR TRADE, s.r.o. - Konkurz č. 32K/27/2011"
 * Business names may themselves contain " - " ("CORNER - STONE …"), so the
 * name ends at the identity parenthetical, not at the first dash. Pure.
 */
export function parseRowLabel(label) {
    const clean = label.replace(/\s+/g, " ").trim();
    // Case number after the trailing "č.".
    const spisovaZnacka = /\s[čc]\.\s*(\S+)\s*$/i.exec(clean)?.[1]?.trim() ?? "";
    // Identity parenthetical: birth date (FO) or "IČO: N". Take the last one.
    const idRe = /\(\s*(\d{1,2}\.\d{1,2}\.\d{4}|I[ČC]O\s*:?\s*\d{6,8})\s*\)/gi;
    let idMatch = null;
    for (let m = idRe.exec(clean); m !== null; m = idRe.exec(clean))
        idMatch = m;
    let birthDate = null;
    let ico = null;
    let debtorName;
    let tail;
    if (idMatch) {
        debtorName = clean.slice(0, idMatch.index).trim();
        tail = clean.slice(idMatch.index + idMatch[0].length);
        const date = /^\d{1,2}\.\d{1,2}\.\d{4}$/.exec(idMatch[1]);
        if (date)
            birthDate = date[0];
        else
            ico = /(\d{6,8})/.exec(idMatch[1])?.[1] ?? null;
    }
    else {
        // No parenthetical: the tail is " - <type> č. <spZn>", where the type may
        // itself be "Oddlženie - …".
        const t = /\s+-\s+((?:Oddlženie\s+-\s+)?[^-]+?\s+[čc]\.\s*\S+)\s*$/i.exec(clean);
        debtorName = (t ? clean.slice(0, t.index) : clean).trim();
        tail = t ? ` - ${t[1]}` : "";
    }
    let seg = tail.replace(/^\s*-\s*/, "");
    const cn = /\s+[čc]\.\s*\S/i.exec(seg);
    if (cn)
        seg = seg.slice(0, cn.index);
    const proceedingType = seg.replace(/\s*-\s*$/, "").trim();
    // Row-level type is a heuristic: a row shows only a birth date or an IČO.
    // The detail header "(FO)/(FOP)/(PO)" is authoritative.
    let subjectType = "PO";
    if (birthDate)
        subjectType = "FO";
    else if (ico && /podnikate[ľl]|\bSZČO\b/i.test(debtorName))
        subjectType = "FOP";
    return { debtorName, birthDate, ico, subjectType, proceedingType, spisovaZnacka };
}
export function parseKonanieId(s) {
    const m = /konanieId=(\d+)/i.exec(s);
    return m ? parseInt(m[1], 10) : 0;
}
// ---------------------------------------------------------------------------
// Case-detail parsing
// ---------------------------------------------------------------------------
/** Inner HTML of the <div> whose opening tag ends at `from`, with nested divs balanced. */
function balancedDivInner(html, from) {
    const tagRe = /<\/?div\b[^>]*>/gi;
    tagRe.lastIndex = from;
    let depth = 1;
    let m;
    while ((m = tagRe.exec(html)) !== null) {
        depth += m[0][1] === "/" ? -1 : 1;
        if (depth === 0)
            return html.slice(from, m.index);
    }
    return html.slice(from);
}
/**
 * Read the labelled sections of the detail page: each field is
 * `<div class="col-xs-3">Label:</div><div class="col-xs-9">value</div>`.
 * A section that is present but empty maps to "" — never to text borrowed
 * from a later part of the page. Pure.
 */
export function parseDetailSections(html) {
    const footer = html.search(/<div[^>]*id=["']footer["']/i);
    const body = footer >= 0 ? html.slice(0, footer) : html;
    const sections = new Map();
    const re = /<div\s+class=["']col-xs-3["'][^>]*>\s*([^<]+?)\s*:\s*<\/div>\s*<div\s+class=["']col-xs-9[^"']*["'][^>]*>/gi;
    let m;
    while ((m = re.exec(body)) !== null) {
        const label = decodeHtmlEntities(m[1]).replace(/\s+/g, " ").trim();
        if (!sections.has(label))
            sections.set(label, balancedDivInner(body, re.lastIndex));
    }
    return sections;
}
/** Normalize detail text: collapse whitespace and drop the space before commas. */
function detailText(html) {
    return inlineText(html).replace(/\s+,/g, ",").trim();
}
/** "Name od dd.mm.yyyy" entries (current trustee or trustee history). */
function parseSpravcaList(html) {
    const text = detailText(html);
    const out = [];
    for (const m of text.matchAll(/(.+?)\s+od\s+(\d{1,2}\.\d{1,2}\.\d{4})\s*/g)) {
        out.push({ nazov: m[1].trim(), odDatumu: m[2] });
    }
    if (out.length === 0 && text)
        out.push({ nazov: text, odDatumu: null });
    return out;
}
/**
 * Parse the konanieDetail.xhtml page into a structured case record. Pure:
 * operates on an HTML string.
 */
export function parseCaseDetail(html, konanieId, baseUrl = DEFAULT_BASE) {
    const sections = parseDetailSections(html);
    const section = (label) => sections.get(label) ?? null;
    const text = (label) => {
        const raw = section(label);
        return raw === null ? null : nullIfDash(detailText(raw));
    };
    // Spisová značka, typ konania: "31K/28/2025, Konkurz"
    const spisTyp = text("Spisová značka, typ konania");
    let spisovaZnacka = null;
    let typKonania = null;
    if (spisTyp) {
        const ci = spisTyp.indexOf(",");
        spisovaZnacka = (ci >= 0 ? spisTyp.slice(0, ci) : spisTyp).trim();
        typKonania = ci >= 0 ? spisTyp.slice(ci + 1).trim() || null : null;
    }
    const povodnaSpisovaZnacka = text("Pôvodná spisová značka");
    // Súvisiace konania: "<a href=…konanieId=N>22K/35/2025</a> (Mestský súd Bratislava III)"
    const suvisiaceKonania = [];
    const suvRaw = section("Súvisiace konania");
    if (suvRaw) {
        const linkRe = /<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>\s*(?:\(([^)]*)\))?/gi;
        for (const m of suvRaw.matchAll(linkRe)) {
            const spZn = detailText(m[2]);
            if (!spZn)
                continue;
            const id = parseKonanieId(decodeHtmlEntities(m[1]));
            suvisiaceKonania.push({
                spisovaZnacka: spZn,
                sud: m[3] ? nullIfDash(detailText(m[3])) : null,
                konanieId: id || null,
            });
        }
        if (suvisiaceKonania.length === 0) {
            const t = nullIfDash(detailText(suvRaw));
            if (t)
                suvisiaceKonania.push({ spisovaZnacka: t, sud: null, konanieId: null });
        }
    }
    const detailHeader = parseDetailHeader(html);
    const subjectType = detailHeader.subjectType;
    const upadca = detailHeader.upadca ?? { meno: "", datumNarodenia: null, ico: null, adresa: null };
    // Súd: "Okresný súd X, odvolací súd Krajský súd v Y"
    const sudRaw = text("Súd");
    let sud = null;
    let odvolaciSud = null;
    if (sudRaw) {
        const om = /odvolac[ií]\s+s[úu]d\s+(.+)$/i.exec(sudRaw);
        if (om) {
            odvolaciSud = om[1].trim();
            sud = sudRaw.slice(0, om.index).replace(/[,\s]+$/, "").trim();
        }
        else {
            sud = sudRaw;
        }
    }
    const sudca = text("Sudca");
    const spravcaRaw = section("Správca");
    const spravca = spravcaRaw && nullIfDash(detailText(spravcaRaw)) ? parseSpravcaList(spravcaRaw)[0] ?? null : null;
    const historiaRaw = section("História správcov");
    const historiaSpravcov = historiaRaw && nullIfDash(detailText(historiaRaw)) ? parseSpravcaList(historiaRaw) : [];
    // Stav konania: "17.09.2026 - Skončená reštrukturalizácia, odsúhlasený plán"
    const stavKonania = parseStav(text("Stav konania"));
    // Posledný verejný oznam: "08.06.2026 - Uznesenie"
    const oznamRaw = text("Posledný verejný oznam");
    let poslednyVerejnyOznam = null;
    if (oznamRaw) {
        const s = parseStav(oznamRaw);
        poslednyVerejnyOznam = s ? { datum: s.datum, typ: s.stav } : { datum: null, typ: oznamRaw };
    }
    // História stavov konania: one "row timeline" per status.
    const historiaStavovRaw = section("História stavov konania") ?? "";
    const historiaStavov = historiaStavovRaw
        .split(/<div[^>]*class=["'][^"']*\btimeline\b[^"']*["'][^>]*>/i)
        .slice(1)
        .map((part) => parseStav(nullIfDash(detailText(part))))
        .filter((s) => s !== null);
    // Navrhovatelia: one block per proposer; an empty section stays empty.
    const navrhRaw = section("Navrhovatelia") ?? "";
    const navrhBlocks = navrhRaw.split(/<div[^>]*class=["'](?:pravnickaOsoba|fyzickaOsoba)[^"']*["'][^>]*>/i);
    const navrhParts = navrhBlocks.length > 1 ? navrhBlocks.slice(1) : [navrhRaw];
    const navrhovatelia = navrhParts
        .map((part) => detailText(part)
        .replace(/,\s*I[ČC]O\s*,/gi, ",")
        .replace(/\s*,\s*/g, ", ")
        .replace(/[,\s]+$/, "")
        .trim())
        .filter((x) => x.length > 0);
    // Lehoty: rows of the lehoty data grid only ("date - description").
    const lehotyRaw = section("Lehoty") ?? "";
    const lehoty = lehotyRaw
        .split(/<tr[^>]*class=["'][^"']*ui-datagrid-row[^"']*["'][^>]*>/i)
        .slice(1)
        .map((row) => {
        const datum = /(\d{1,2}\.\d{1,2}\.\d{4})/.exec(row)?.[1] ?? null;
        const desc = /<div\s+class=["']col-xs-6["'][^>]*>([\s\S]*?)<\/div>/i.exec(row)?.[1];
        const popis = desc ? detailText(desc) : "";
        return datum && popis ? `${datum} - ${popis}` : popis || datum || "";
    })
        .filter((x) => x.length > 0);
    const typPodlaUzemnejPlatnosti = text("Typ konania podľa územnej platnosti");
    return {
        konanieId,
        spisovaZnacka,
        typKonania,
        povodnaSpisovaZnacka,
        suvisiaceKonania,
        subjectType,
        upadca,
        sud,
        odvolaciSud,
        sudca,
        spravca,
        historiaSpravcov,
        stavKonania,
        historiaStavov,
        poslednyVerejnyOznam,
        navrhovatelia,
        lehoty,
        typPodlaUzemnejPlatnosti,
        tabCounts: parseTabCounts(flattenToText(html)),
        detailUrl: `${baseUrl}${DETAIL_PATH}?konanieId=${konanieId}`,
    };
}
function parseDetailHeader(html) {
    const m = /<div[^>]*class=["'][^"']*\bdetail\b[^"']*["'][^>]*>[\s\S]*?<h1[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>[\s\S]*?<\/h1>[\s\S]*?<h2[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i.exec(html);
    if (!m)
        return { subjectType: null, upadca: null };
    const title = detailText(m[1]);
    const address = detailText(m[2]) || null;
    const subjectType = /^\((FOP|FO|PO)\)/i.exec(title)?.[1]?.toUpperCase();
    const birth = /\((\d{1,2}\.\d{1,2}\.\d{4})\)/.exec(title);
    const ico = /I[ČC]O\s*:?\s*(\d{6,8})/i.exec(title)?.[1] ?? null;
    const meno = title
        .replace(/^\((?:FOP|FO|PO)\)\s*/i, "")
        .replace(/\(\d{1,2}\.\d{1,2}\.\d{4}\)/, "")
        .replace(/I[ČC]O\s*:?\s*\d{6,8}/i, "")
        .replace(/[,\s]+$/, "")
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
function parseTabCounts(flat) {
    const count = (label) => {
        const re = new RegExp(`${escapeRegExp(label)}\\s*\\(\\s*(\\d+)\\s*\\)`, "i");
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
/** Flatten HTML to a single normalized text line. */
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
    /**
     * Session handshake: GET the homepage to obtain the JSESSIONID cookie
     * (scoped to /ru-verejnost-web). The register used to 302 every deep request
     * without it; as of 9. 10. 2026 it no longer does, but the cookie is cheap
     * insurance against that coming back. Fills the cookie jar.
     */
    async handshake(jar) {
        const html = await this.requestText(`${this.base}${HOME_PATH}`, {
            method: "GET",
            headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        }, false, jar);
        void html;
    }
    /** GET one server-rendered search page (1-based source page). */
    fetchSearchPage(jar, query, zobrazKonania, sourcePage) {
        const params = new URLSearchParams({ page: String(sourcePage), query, zobrazKonania });
        return this.requestText(`${this.base}${SEARCH_PATH}?${params.toString()}`, {
            method: "GET",
            headers: { "User-Agent": USER_AGENT, Accept: "text/html", Cookie: cookieHeader(jar) },
        }, false, jar);
    }
    /**
     * ru_search: handshake → GET the server-rendered search page(s)
     * searchKonanie.xhtml?query=…&zobrazKonania=…&page=N and parse the rows.
     *
     * The register's own form defaults to "Len prebiehajúce konania"; this
     * client asks for zobrazKonania=all unless told otherwise, so finished,
     * stopped and dismissed proceedings are not silently dropped. The source
     * pages by 15 rows; page/pageSize are mapped onto as many source pages as
     * needed. An empty result is returned only when the source said
     * "Nenašli sa žiadne konania"; anything unrecognized is an error.
     */
    async search(params) {
        const query = params.query.trim();
        if (!query)
            throw new RuMcpError("RU_INPUT", "RU query is required.");
        if (Buffer.byteLength(query, "utf8") > MAX_QUERY_BYTES)
            throw new RuMcpError("RU_INPUT_TOO_LARGE", "RU query is too large.");
        const page = params.page ?? 0;
        const pageSize = params.pageSize ?? SOURCE_PAGE_SIZE;
        const zobrazKonania = params.zobrazKonania ?? "all";
        const prebiehajuce = zobrazKonania === "prebiehajuce" ? true : zobrazKonania === "ukoncene" ? false : null;
        const offset = page * pageSize;
        const firstSourcePage = Math.floor(offset / SOURCE_PAGE_SIZE) + 1;
        const lastSourcePage = Math.floor((offset + pageSize - 1) / SOURCE_PAGE_SIZE) + 1;
        const jar = new Map();
        await this.handshake(jar);
        let total = null;
        const collected = [];
        for (let sp = firstSourcePage; sp <= lastSourcePage; sp++) {
            if (total !== null && (sp - 1) * SOURCE_PAGE_SIZE >= total)
                break;
            const html = await this.fetchSearchPage(jar, query, zobrazKonania, sp);
            if (isNoResultsPage(html)) {
                if (!/<form[^>]*id=["']searchKonanieForm["']/i.test(html)) {
                    throw new RuMcpError("RU_SOURCE_PARSE", "RU search structure was not recognized.");
                }
                total = 0;
                break;
            }
            const pageTotal = parsePocetVysledkov(html);
            if (pageTotal === null) {
                throw new RuMcpError("RU_SOURCE_PARSE", "RU result count was not recognized; the result is not validated.");
            }
            total = pageTotal;
            const shownPage = parseCurrentPage(html);
            if (shownPage !== null && shownPage !== sp) {
                throw new RuMcpError("RU_SOURCE_PARSE", "RU source returned a different result page.");
            }
            const rows = parseSearchRows(html, this.base, prebiehajuce);
            const expected = Math.max(0, Math.min(SOURCE_PAGE_SIZE, total - (sp - 1) * SOURCE_PAGE_SIZE));
            if (rows.length !== expected) {
                throw new RuMcpError("RU_SOURCE_PARSE", "RU result rows do not match the announced count.");
            }
            collected.push(...rows);
        }
        const skip = offset - (firstSourcePage - 1) * SOURCE_PAGE_SIZE;
        const seen = new Set();
        const results = collected
            .slice(skip, skip + pageSize)
            .filter((r) => (seen.has(r.konanieId) ? false : (seen.add(r.konanieId), true)));
        return {
            query,
            zobrazKonania,
            pocetVysledkov: total,
            page,
            pageSize,
            hasMore: total !== null && offset + pageSize < total,
            results,
        };
    }
    /**
     * ru_get_case: GET the case-detail deep link and parse the labelled fields
     * incl. trustee, trustee history, status and status history.
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
        if (!hasId || !parseDetailSections(html).has("Spisová značka, typ konania")) {
            throw new RuMcpError("RU_SOURCE_PARSE", "RU case structure was not recognized.");
        }
        return parseCaseDetail(html, konanieId, this.base);
    }
}
