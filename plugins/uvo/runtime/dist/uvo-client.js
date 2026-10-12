export const DEFAULT_UVO_BASE_URL = "https://www.uvo.gov.sk";
const DEFAULT_BASE = DEFAULT_UVO_BASE_URL;
const SEARCH_PATH = "/vyhladavanie/vyhladavanie-zakaziek";
const NOTICE_PATH = "/vestnik-a-registre/vestnik/oznamenie/detail";
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const MAX_TEXT_FIELD_BYTES = 8 * 1024;
/** Aggregation bound of uvo_get_contracting_authority. */
export const MAX_PAGES = 20;
/** Highest page uvo_search accepts; one IČO can span dozens of source pages (NDS: 58). */
export const MAX_SEARCH_PAGE = 1_000;
export const MAX_ROWS = 2_000;
export const UPSTREAM_CONCURRENCY = 4;
/**
 * A "Nenašli sa žiadne záznamy" answer that took at least this long is not
 * trusted: on 2026-10-09/12 the source returned it after ~30 s (its internal
 * time limit) for queries that hold hundreds of rows.
 */
export const SLOW_EMPTY_MS = 25_000;
export class UvoSourceError extends Error {
    code;
    transient;
    constructor(code, message, transient = false) {
        super(message);
        this.code = code;
        this.transient = transient;
        this.name = "UvoSourceError";
    }
}
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 uvo-mcp/0.2";
/** The search form offers -1|TOVARY|SLUZBY|PRACE|SUHRNY; anything else yields "no records". */
const CONTRACT_TYPE_CODES = {
    tovary: "TOVARY",
    sluzby: "SLUZBY",
    "stavebne prace": "PRACE",
    TOVARY: "TOVARY",
    SLUZBY: "SLUZBY",
    PRACE: "PRACE",
    SUHRNY: "SUHRNY",
};
const NO_RECORDS_RE = /Nenašli sa žiadne záznamy/i;
// ===========================================================================
// Pure parsing helpers (no network) — exercised directly by unit tests.
// ===========================================================================
export function decodeHtmlEntities(s) {
    return s
        .replace(/&#(\d+);/g, (_, d) => decodeNumericEntity(d, 10))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => decodeNumericEntity(h, 16))
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, " ");
}
function decodeNumericEntity(raw, radix) {
    const value = Number.parseInt(raw, radix);
    if (!Number.isSafeInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
        throw new UvoSourceError("UVO_SCHEMA", "UVO public source contains a malformed numeric entity.");
    }
    try {
        return String.fromCodePoint(value);
    }
    catch {
        throw new UvoSourceError("UVO_SCHEMA", "UVO public source contains a malformed numeric entity.");
    }
}
/** Strip tags; quoted attribute values may contain ">" (e.g. the EVO badge title). */
function stripTags(html) {
    return decodeHtmlEntities(html.replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}
/** Convert "dd.mm.yyyy" to ISO "yyyy-mm-dd"; pass through anything else. */
export function toIsoDate(s) {
    if (!s)
        return "";
    const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
    if (!m)
        return s.trim();
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
/** Extract the numeric id from a /detail/{id} style link. */
function extractIdFromDetail(url) {
    const m = /\/detail\/(\d+)/.exec(url);
    return m ? m[1] : "";
}
/** True for the "Nedostupné" page the source serves (HTTP 200) during outages. */
export function isUnavailablePage(html) {
    return /<title>\s*Nedostupne\s*<\/title>/i.test(html) || /služba je dočasne nedostupná/i.test(html);
}
function unavailableError(detail) {
    return new UvoSourceError("UVO_UNAVAILABLE", `Zdroj ÚVO je dočasne nedostupný (${detail}). Nejde o prázdny výsledok — zopakuj dopyt neskôr.`);
}
/**
 * The one results table: marked (id="lists-table", id="zakazky-result-table"
 * or class "table") and carrying the "Názov zákazky"/"Názov obstarávateľa"
 * heading. Null when absent; ambiguous markup is a schema error.
 */
function findResultsTable(html) {
    const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)]
        .map((match) => match[0])
        .filter((table) => {
        const openingTag = /^<table\b[^>]*>/i.exec(table)?.[0] ?? "";
        const hasMarker = /\bid\s*=\s*["'](?:lists-table|zakazky-result-table)["']/i.test(openingTag)
            || /\bclass\s*=\s*["'][^"']*\btable\b[^"']*["']/i.test(openingTag);
        return hasMarker && /(?:Názov\s+zákazky|Názov\s+obstarávateľa)/i.test(table);
    });
    if (tables.length > 1)
        throw new UvoSourceError("UVO_SCHEMA", "UVO result table marker is ambiguous.");
    return tables[0] ?? null;
}
/**
 * Parse the zákazky results table into structured rows.
 * Returns [] only for the source's explicit "Nenašli sa žiadne záznamy" page;
 * any other page without the table is an error, never an empty result.
 */
export function parseSearchRows(html, base = DEFAULT_BASE) {
    const table = findResultsTable(html);
    if (table)
        return parseTableRows(table, base);
    if (isUnavailablePage(html))
        throw unavailableError("stránka „Nedostupné“");
    if (NO_RECORDS_RE.test(html))
        return [];
    throw new UvoSourceError("UVO_SCHEMA", "Stránka ÚVO nemá výsledkovú tabuľku ani hlásenie „Nenašli sa žiadne záznamy“ — výsledok sa nedá určiť.");
}
function parseTableRows(table, base) {
    const rows = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(table)) !== null) {
        const rowHtml = rowMatch[1];
        // Skip header rows (no <td>).
        if (!/<td/i.test(rowHtml))
            continue;
        const cells = [];
        const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
            cells.push(cellMatch[1]);
        }
        if (cells.length === 0)
            continue;
        const zakazkaLink = extractHref(cells[0] ?? "", /vyhladavanie-zakaziek\/detail\//i);
        const zakazkaId = extractIdFromDetail(zakazkaLink);
        // Skip non-data rows that carry no contract detail link.
        if (!zakazkaId)
            continue;
        const authorityLink = extractHref(cells[1] ?? "", /vyhladavanie-profilov\/detail\//i);
        rows.push({
            zakazkaId,
            detailUrl: absolutize(zakazkaLink, base),
            title: stripTags(cells[0] ?? ""),
            authorityName: stripTags(cells[1] ?? ""),
            authorityProfileId: extractIdFromDetail(authorityLink),
            mainCpvLabel: stripTags(cells[2] ?? ""),
            nutsLabel: stripTags(cells[3] ?? ""),
            updated: toIsoDate(stripTags(cells[4] ?? "")),
            // Badge columns (e.g. "EVO") follow the date; the source currently uses the 9th cell.
            source: cells.slice(5).map(stripTags).filter(Boolean).join(", "),
        });
    }
    return rows;
}
function extractHref(cellHtml, mustMatch) {
    const re = /href=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(cellHtml)) !== null) {
        const url = decodeHtmlEntities(m[1]);
        if (mustMatch.test(url))
            return url;
    }
    return "";
}
function absolutize(url, base) {
    if (!url)
        return "";
    if (/^https?:\/\//i.test(url))
        return url;
    return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}
/**
 * Pagination. The source pages with `page` (paginator.goToPage); the
 * "Ďalšia" link carries page=N+1 and "Posledná" the last page.
 */
export function parsePagination(html, currentPage) {
    const nextHref = /<a\b[^>]*href=["']([^"']*)["'][^>]*title=["']Ďalšia["']/i.exec(html)?.[1];
    const nextPage = nextHref ? pageParam(nextHref) : undefined;
    const hasNext = nextPage === currentPage + 1;
    const lastHref = /<a\b[^>]*class=["'][^"']*pag-last[^"']*["'][^>]*href=["']([^"']*)["']/i.exec(html)?.[1];
    const options = /<select[^>]*class=["'][^"']*pag-pageNo[^"']*["'][^>]*>([\s\S]*?)<\/select>/i.exec(html)?.[1] ?? "";
    const optionPages = Array.from(options.matchAll(/<option[^>]*value=["'](\d+)["']/gi), (m) => Number(m[1]));
    const lastPage = lastHref ? pageParam(lastHref) : undefined;
    const totalPages = lastPage ?? (optionPages.length ? Math.max(...optionPages) : null);
    return {
        page: currentPage,
        hasNext,
        nextParam: hasNext ? `page=${currentPage + 1}` : null,
        totalPages,
    };
}
function pageParam(href) {
    const m = /[?&](?:amp;)?page=(\d+)/.exec(href);
    return m ? Number(m[1]) : undefined;
}
/** `let paginator = { data: {...} }` echoes the query the source actually ran. */
function parsePaginatorData(html) {
    const raw = /paginator\s*=\s*\{\s*data\s*:\s*(\{[^\n]*\})\s*,/.exec(html)?.[1];
    if (!raw)
        return undefined;
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
/** Total from `<div class="pag-info"><span class="red">1149 záznamov</span>`; null when blank. */
function parseSourceTotal(html) {
    const m = /class=["'][^"']*\bpag-info\b[^"']*["'][^>]*>\s*<span[^>]*>\s*([\d\s]*?)\s*záznamov/i.exec(html);
    if (!m)
        return undefined;
    const digits = m[1].replace(/\s+/g, "");
    return digits ? Number(digits) : null;
}
// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
/**
 * Parse an amount with currency and VAT flag. The source uses "4 100 000,0000"
 * (classic forms) and "968 622.95" with currency "Euro" (eForms).
 */
export function parseMoney(raw) {
    if (!raw)
        return undefined;
    const numberMatch = /\d[\d\s .,]*/.exec(raw);
    let amount = null;
    if (numberMatch) {
        let s = numberMatch[0].replace(/[\s ]/g, "").replace(/[.,]+$/, "");
        const lastDot = s.lastIndexOf(".");
        const lastComma = s.lastIndexOf(",");
        if (lastDot >= 0 && lastComma >= 0) {
            const decimal = lastDot > lastComma ? "." : ",";
            const thousands = decimal === "." ? "," : ".";
            s = s.split(thousands).join("").replace(decimal, ".");
        }
        else if (lastComma >= 0) {
            s = s.replace(",", ".");
        }
        else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
            s = s.split(".").join("");
        }
        const n = Number(s);
        amount = Number.isFinite(n) ? n : null;
    }
    const cur = /\b(EUR|Euro|USD|CZK|GBP)\b/i.exec(raw)?.[1];
    const currency = cur ? (/^eur/i.test(cur) ? "EUR" : cur.toUpperCase()) : null;
    const vatRaw = /\b(bez DPH|s DPH)\b/i.exec(raw)?.[1];
    const vat = vatRaw ? (/^bez/i.test(vatRaw) ? "bez DPH" : "s DPH") : null;
    return { amount, currency, vat };
}
/**
 * Split the classic notice into numbered subsections. A block runs until the
 * next subtitle that carries a code (uncoded subtitles such as "Kód NUTS:" or
 * "Služby" belong to the enclosing block) or the end of the fieldset.
 * Lookups go by the subsection TITLE: the same number means different things
 * in different form versions (II.1.5 is CPV in 2014 and the estimated value
 * since 2016; I.2 vs I.4 for the authority type).
 */
function classicSubsections(html) {
    const re = /<div[^>]*class=["'][^"']*\bsubtitle\b[^"']*["'][^>]*>\s*<span[^>]*class=["'][^"']*\bcode\b[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<span[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<\/div>/gi;
    const heads = Array.from(html.matchAll(re), (m) => ({
        code: stripTags(m[1]),
        title: stripTags(m[2]),
        start: m.index ?? 0,
        end: (m.index ?? 0) + m[0].length,
    }));
    const out = [];
    heads.forEach((h, i) => {
        if (!h.code)
            return;
        const nextCoded = heads.slice(i + 1).find((n) => n.code);
        let end = nextCoded ? nextCoded.start : html.length;
        const fieldsetEnd = html.indexOf("</fieldset>", h.end);
        if (fieldsetEnd >= 0 && fieldsetEnd < end)
            end = fieldsetEnd;
        out.push({ code: h.code, title: h.title, block: html.slice(h.end, end) });
    });
    return out;
}
function findSubsection(subs, titleRe) {
    return subs.find((s) => titleRe.test(s.title));
}
function spanValues(block) {
    const values = [];
    for (const m of block.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)) {
        const value = stripTags(m[1]);
        if (value && !/^[-–]?$/.test(value) && !values.includes(value))
            values.push(value);
    }
    return values;
}
/** Value of a `<span>Label:</span><span>value</span>` pair inside a block. */
function spanPairValue(html, label) {
    const re = new RegExp(`<span[^>]*>\\s*${escapeRegExp(label)}\\s*:?\\s*</span>\\s*<span[^>]*>([\\s\\S]*?)</span>`, "i");
    const m = re.exec(html);
    return m ? stripTags(m[1]) || undefined : undefined;
}
/** Value of a `<strong>Label:</strong> value` pair (header lines). */
function strongLabelValue(html, label) {
    const re = new RegExp(`<strong>\\s*${escapeRegExp(label)}\\s*:?\\s*</strong>\\s*([\\s\\S]*?)</div>`, "i");
    const m = re.exec(html);
    return m ? stripTags(m[1]) || undefined : undefined;
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Name, IČO, address and country from a ContactSelectList block. */
/** Inner HTML of the element opened at `start`, honouring nested tags of the same name. */
function elementInner(html, start, tag) {
    const open = html.indexOf(">", start) + 1;
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    re.lastIndex = open;
    let depth = 1;
    let m;
    while ((m = re.exec(html)) !== null) {
        depth += m[1] ? -1 : 1;
        if (depth === 0)
            return html.slice(open, m.index);
    }
    return html.slice(open);
}
function parseContact(block) {
    const tvStart = block.search(/<span[^>]*class=["'][^"']*titleValue/i);
    const titleValue = tvStart >= 0 ? elementInner(block, tvStart, "span") : "";
    const name = stripTags(/<span[^>]*class=["'][^"']*\bbold\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(titleValue)?.[1] ?? "") || undefined;
    const textTag = /<text[^>]*>([\s\S]*?)<\/text>/i.exec(titleValue)?.[1];
    // Address is the bare text node of titleValue (2014) or a <text> element (2016+).
    const address = textTag !== undefined
        ? stripTags(textTag) || undefined
        : stripTags(titleValue.replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, " ")) || undefined;
    return {
        name,
        ico: spanPairValue(block, "Vnútroštátne identifikačné číslo"),
        address,
        country: /<span>\s*Slovensko\s*<\/span>/i.test(block) ? "Slovensko" : undefined,
        nuts: spanPairValue(block, "Kód NUTS"),
        email: spanPairValue(block, "Email"),
        url: spanPairValue(block, "Hlavná adresa(URL)") ?? spanPairValue(block, "Hlavná adresa"),
    };
}
/** Money following a text label, cut before the next value label. */
function moneyAfterText(text, labelRe) {
    const global = new RegExp(labelRe.source, labelRe.flags.includes("g") ? labelRe.flags : `${labelRe.flags}g`);
    for (const m of text.matchAll(global)) {
        let rest = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 300);
        const stop = rest.search(/Celková konečná hodnota|Prvotná predpokladaná|ODDIEL|Informácia o subdodávkach|\b[IVX]+\.\d+(?:\.\d+)?\)/i);
        if (stop >= 0)
            rest = rest.slice(0, stop);
        // The amount must follow a "Hodnota" label, so a section number such as "II.2.1)" is never read as money.
        const value = /Hodnota\s*:?\s*(\d[\s\S]*)$/i.exec(rest)?.[1];
        if (value)
            return parseMoney(value);
    }
    return undefined;
}
function parseClassicNotice(html, warnings) {
    const all = classicSubsections(html);
    const sectionI = all.filter((s) => /^I\./.test(s.code));
    const subs = all.filter((s) => /^II\./.test(s.code));
    const text = stripTags(html);
    // ----- ODDIEL I: contracting authority -----
    const namesBlock = findSubsection(sectionI, /^NÁZOV/i)?.block ?? "";
    const contact = parseContact(namesBlock);
    const typeBlock = findSubsection(sectionI, /DRUH (VEREJNÉHO )?OBSTARÁVATEĽA/i)?.block;
    const activityBlock = findSubsection(sectionI, /HLAVNÁ ČINNOSŤ/i)?.block;
    const authority = {
        name: contact.name,
        ico: contact.ico,
        address: contact.address,
        nuts: contact.nuts,
        country: contact.country,
        email: contact.email,
        url: contact.url,
        authorityType: typeBlock ? spanValues(typeBlock).at(-1) : undefined,
        mainActivity: activityBlock ? spanValues(activityBlock).at(-1) : undefined,
    };
    // ----- ODDIEL II: subject -----
    const titleSub = findSubsection(subs, /^Názov/i);
    const cpvMainSub = findSubsection(subs, /Hlavný kód CPV/i);
    const cpvVocabularySub = findSubsection(subs, /Spoločný slovník obstarávania|\(CPV\)/i);
    const cpvAdditionalSub = findSubsection(subs, /Dodatočné kódy CPV/i);
    const descriptionSub = findSubsection(subs, /^Stručný opis/i);
    const placeSub = findSubsection(subs, /^Miesto vykonania|Druh zákazky a miesto/i);
    const vocabularyCodes = cpvVocabularySub ? Array.from(stripTags(cpvVocabularySub.block).matchAll(/\b\d{8}-\d\b/g), (m) => m[0]) : [];
    const mainCpv = (cpvMainSub ? spanValues(cpvMainSub.block).find((v) => /^\d{8}-\d$/.test(v)) : undefined) ?? vocabularyCodes[0];
    const additionalCpv = cpvAdditionalSub
        ? spanValues(cpvAdditionalSub.block).filter((v) => /^\d{8}-\d$/.test(v))
        : vocabularyCodes.slice(1);
    const titleRaw = titleSub ? stripTags(titleSub.block) : undefined;
    const estimatedSub = findSubsection(subs, /odhadovaná hodnota/i);
    const estimatedValue = (estimatedSub && /\d/.test(stripTags(estimatedSub.block)) ? parseMoney(stripTags(estimatedSub.block)) : undefined) ??
        moneyAfterText(text, /Prvotná predpokladaná celková hodnota zákazky/i);
    const finalValue = moneyAfterText(text, /Celková konečná hodnota zákazky/i);
    const subject = {
        title: titleRaw?.replace(/\s*Referenčné číslo:.*$/i, "").trim() || undefined,
        referenceNumber: /Referenčné číslo:\s*<span[^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1]
            ? stripTags(/Referenčné číslo:\s*<span[^>]*>([\s\S]*?)<\/span>/i.exec(html)[1]) || undefined
            : undefined,
        mainCpv,
        additionalCpv,
        shortDescription: descriptionSub ? stripTags(descriptionSub.block) || undefined : undefined,
        estimatedValue,
        finalValue,
        placeNuts: placeSub ? /\b(SK\d{3})\b/.exec(stripTags(placeSub.block))?.[1] : undefined,
    };
    // ----- ODDIEL V: award -----
    const awardedTo = all
        .filter((s) => /V PROSPECH KTORÉHO|NÁZOV A ADRESA DODÁVATEĽA|Názov a adresa (?:úspešného )?uchádzača/i.test(s.title))
        .map((s) => {
        const c = parseContact(s.block);
        return pruneOperator({ name: c.name, ico: c.ico, address: c.address, country: c.country });
    })
        .filter((op) => op.name);
    // Header lines: Druh postupu / Druh zákazky.
    const procedureType = strongLabelValue(html, "Druh postupu");
    const contractType = strongLabelValue(html, "Druh zákazky") ??
        (findSubsection(subs, /^Druh zákazky$/i) ? spanValues(findSubsection(subs, /^Druh zákazky$/i).block)[0] : undefined);
    if (!authority.name)
        warnings.push("Názov obstarávateľa sa v oddiele I nepodarilo prečítať — over na sourceUrl.");
    return {
        procedureType,
        contractType,
        authority,
        subject,
        awardedTo: awardedTo.length ? awardedTo : undefined,
    };
}
function pruneOperator(op) {
    return Object.fromEntries(Object.entries(op).filter(([, v]) => v !== undefined && v !== ""));
}
/** Ordered "Label: value" items of the eForms output (`ul.notice-list li`). */
function eformsItems(container) {
    const items = [];
    let section = "";
    let heading = "";
    const re = /<div[^>]*class=["']list-title["'][^>]*>([\s\S]*?)<\/div>|<li>([\s\S]*?)<\/li>/gi;
    for (const m of container.matchAll(re)) {
        if (m[1] !== undefined) {
            section = stripTags(m[1]);
            heading = "";
            continue;
        }
        const inner = m[2] ?? "";
        if (/list-sub-title/i.test(inner)) {
            heading = stripTags(inner);
            continue;
        }
        const t = stripTags(inner);
        const idx = t.indexOf(":");
        if (idx < 0)
            continue;
        items.push({ section, heading, label: t.slice(0, idx).trim(), value: t.slice(idx + 1).trim() });
    }
    return items;
}
function eformsOrganizations(items) {
    const orgs = [];
    let current;
    for (const it of items.filter((i) => /^\d+\.\s*Organizácie/.test(i.section))) {
        if (it.label === "Názov organizácie") {
            current = { name: it.value, mainBuyer: false };
            orgs.push(current);
            continue;
        }
        if (!current)
            continue;
        switch (it.label) {
            case "IČO":
                current.ico ??= it.value;
                break;
            case "Ulica":
                current.street ??= it.value;
                break;
            case "Číslo":
                current.number ??= it.value;
                break;
            case "Mesto":
                current.city ??= it.value;
                break;
            case "PSČ":
                current.postcode ??= it.value;
                break;
            case "Krajina":
                current.country ??= it.value;
                break;
            case "E-mail":
                current.email ??= it.value;
                break;
            case "Internetová adresa (URL)":
                current.url ??= it.value;
                break;
            case "Hlavný kupujúci":
                current.mainBuyer = /^áno$/i.test(it.value);
                break;
        }
    }
    return orgs;
}
function parseEformsNotice(container, warnings) {
    const items = eformsItems(container);
    // Sections are matched by title: their numbers differ between eForms subtypes.
    const inSection = (title) => items.filter((i) => title.test(i.section.replace(/^\d+\.\s*/, "")));
    const first = (list, label) => list.find((i) => (typeof label === "string" ? i.label === label : label.test(i.label)))?.value || undefined;
    const basics = inSection(/^Základné údaje/);
    const buyers = inSection(/^Kupujúci/);
    const procedure = inSection(/^Postup/);
    // Buyer: the organization flagged "Hlavný kupujúci: áno"; the first listed
    // organization is usually ÚVO acting as TED eSender, not the buyer.
    const orgs = eformsOrganizations(items);
    const buyerRef = /\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/.exec(first(buyers, /^ID kupujúceho/) ?? "")?.[1];
    const buyer = orgs.find((o) => o.mainBuyer) ?? (buyerRef ? orgs.find((o) => o.name === buyerRef) : undefined);
    if (!buyer)
        warnings.push("Hlavného kupujúceho sa v zozname organizácií nepodarilo určiť — over na sourceUrl.");
    const streetLine = [buyer?.street, buyer?.number].filter(Boolean).join(" ");
    const cityLine = [buyer?.postcode, buyer?.city].filter(Boolean).join(" ");
    const authority = {
        name: buyer?.name,
        ico: buyer?.ico,
        address: [streetLine, cityLine].filter(Boolean).join(", ") || undefined,
        country: buyer?.country,
        email: buyer?.email,
        url: buyer?.url ?? first(buyers, "Profil kupujúceho (URL)"),
        authorityType: first(buyers, "Typ kupujúceho podľa právnych predpisov"),
        mainActivity: first(buyers, "Činnosť verejného obstarávateľa"),
    };
    const mainCpvRaw = first(procedure, "Hlavný CPV kód");
    const additionalRaw = procedure.filter((i) => i.label === "Doplňujúci CPV kód").map((i) => i.value);
    const additionalCpv = [];
    for (const raw of additionalRaw) {
        const parts = raw.split(/\s*,\s*/);
        if (parts.every((p) => /^\d{8}(-\d)?$/.test(p))) {
            for (const p of parts)
                if (!additionalCpv.includes(p))
                    additionalCpv.push(p);
        }
        else {
            warnings.push(`Doplnkový CPV uvádza zdroj len slovne („${raw}“), bez kódu.`);
        }
    }
    let estimatedValue;
    const procValue = first(procedure, /^Predpokladaná hodnota \(BT-27-Procedure\) \(hodnota\)$/);
    const procCurrency = first(procedure, /^Predpokladaná hodnota \(BT-27-Procedure\) \(mena\)$/);
    if (procValue) {
        estimatedValue = parseMoney(`${procValue} ${procCurrency ?? ""}`);
    }
    else {
        const lotValues = items.filter((i) => /^Predpokladaná hodnota \(BT-27-Lot\) \(hodnota\)$/.test(i.label));
        if (lotValues.length === 1) {
            const lotCurrency = items.find((i) => /^Predpokladaná hodnota \(BT-27-Lot\) \(mena\)$/.test(i.label))?.value ?? "";
            estimatedValue = parseMoney(`${lotValues[0].value} ${lotCurrency}`);
            warnings.push("Predpokladaná hodnota je prevzatá z jedinej časti (BT-27-Lot); hodnotu celého postupu zdroj neuvádza.");
        }
        else if (lotValues.length > 1) {
            warnings.push(`Predpokladanú hodnotu uvádza zdroj len po častiach (${lotValues.length} častí); súčet sa nepočíta.`);
        }
    }
    const subject = {
        title: first(procedure, "Názov"),
        referenceNumber: first(procedure, "Referenčné číslo"),
        mainCpv: mainCpvRaw && /^\d{8}(-\d)?$/.test(mainCpvRaw) ? mainCpvRaw : undefined,
        mainCpvLabel: mainCpvRaw && !/^\d{8}(-\d)?$/.test(mainCpvRaw) ? mainCpvRaw : undefined,
        additionalCpv,
        shortDescription: first(procedure, "Opis"),
        estimatedValue,
        placeNuts: undefined,
        placeNutsLabel: first(procedure, "Nižšia územná jednotka krajiny"),
    };
    if (items.some((i) => /^\d+\.\s*Výsledok/.test(i.section))) {
        warnings.push("Výsledok (dodávateľ, hodnota zmluvy) z eForms oznámenia parser nevyberá — over na sourceUrl.");
    }
    const zakazka = first(basics, "Zákazka");
    return {
        noticeType: stripTags(/<h3[^>]*class=["']title["'][^>]*>([\s\S]*?)<\/h3>/i.exec(container)?.[1] ?? "") || undefined,
        noticeSubtype: first(basics, "Podtyp oznámenia"),
        procedureType: first(procedure, "Druh postupu"),
        contractType: first(procedure, "Druh zákazky"),
        authority,
        subject,
        relatedZakazkaId: zakazka ? /\(ID:\s*(\d+)\)\s*$/.exec(zakazka)?.[1] : undefined,
    };
}
/**
 * Parse a notice-detail HTML page into structured fields. Classic forms are
 * read by subsection titles, eForms by their labels. A page that is neither
 * is rejected — never returned as an empty notice.
 */
export function parseNoticeDetail(html, noticeId, sourceUrl) {
    if (isUnavailablePage(html))
        throw unavailableError("stránka „Nedostupné“");
    if (!/<h1[^>]*>\s*Oznámenie\s+\d+/i.test(html)) {
        throw new UvoSourceError("UVO_SCHEMA", `Stránka ÚVO pre oznámenie ${noticeId} nemá hlavičku „Oznámenie …“.`);
    }
    const warnings = [];
    const text = stripTags(html);
    // Header: "Oznámenie 740 - MUT", "Vestník č. 6/2023 - 10.01.2023".
    const noticeCode = /Oznámenie\s+(\d+\s*-\s*[A-ZÀ-Ž]+)/i.exec(text)?.[1]?.replace(/\s*-\s*/, "-").replace(/\s+/g, "");
    const vestnikMatch = /Vestník\s+č\.\s*(\d+\/\d{4})\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4})/i.exec(text);
    const vestnikNumber = vestnikMatch?.[1];
    const publishedDate = vestnikMatch ? toIsoDate(vestnikMatch[2]) : undefined;
    const relatedFromLinks = /dokumenty\/(\d+)/i.exec(html)?.[1] ?? /vyhladavanie-zakaziek\/detail\/(\d+)/i.exec(html)?.[1];
    const containerStart = html.search(/<div[^>]*id=["']output-container["']/i);
    if (containerStart >= 0) {
        const bodyEnd = html.indexOf("</body>", containerStart);
        const container = html.slice(containerStart, bodyEnd >= 0 ? bodyEnd : undefined);
        const declaredId = /Identifikátor ÚVO:\s*(\d+)/.exec(stripTags(container))?.[1];
        if (declaredId !== noticeId) {
            throw new UvoSourceError("UVO_SCHEMA", `Zdroj vrátil iné oznámenie (${declaredId ?? "bez identifikátora"}) než požadované ${noticeId}.`);
        }
        const e = parseEformsNotice(container, warnings);
        if (!e.noticeType)
            warnings.push("Typ oznámenia (nadpis eForms) chýba.");
        return {
            noticeId,
            formFamily: "eforms",
            noticeCode,
            vestnikNumber,
            publishedDate,
            noticeType: e.noticeType,
            noticeSubtype: e.noticeSubtype,
            procedureType: e.procedureType,
            contractType: e.contractType,
            contractingAuthority: e.authority,
            subject: e.subject,
            relatedZakazkaId: e.relatedZakazkaId ?? relatedFromLinks,
            sourceUrl,
            warnings,
        };
    }
    if (!/ODDIEL\s+I\s*:/i.test(html)) {
        throw new UvoSourceError("UVO_SCHEMA", `Oznámenie ${noticeId} nemá ani klasickú štruktúru (ODDIEL I), ani eForms výstup — formát nie je podporovaný.`);
    }
    // Notice type: the MainHeader that is not the "17786 - VSS" code line.
    const mainHeaders = Array.from(html.matchAll(/<div[^>]*class=["'][^"']*MainHeader[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi), (m) => stripTags(m[1]));
    const noticeType = mainHeaders.find((h) => h && !/^\d+\s*-\s*[A-ZÀ-Ž]+$/i.test(h));
    if (!noticeType)
        warnings.push("Typ oznámenia sa v hlavičke nenašiel.");
    const c = parseClassicNotice(html, warnings);
    return {
        noticeId,
        formFamily: "classic",
        noticeCode,
        vestnikNumber,
        publishedDate,
        noticeType,
        procedureType: c.procedureType,
        contractType: c.contractType,
        contractingAuthority: c.authority,
        subject: c.subject,
        awardedTo: c.awardedTo,
        relatedZakazkaId: relatedFromLinks,
        sourceUrl,
        warnings,
    };
}
// ===========================================================================
// Client
// ===========================================================================
export class UvoClient {
    base;
    fetchImpl;
    timeoutMs;
    slowEmptyMs;
    activeRequests = 0;
    waiters = [];
    constructor(opts = {}) {
        // `??` prepadne len na null/undefined. Keby compose poslal premennú
        // NASTAVENÚ, ALE PRÁZDNU (tvar "${UVO_BASE_URL:-}"), base by bola "" a každé
        // volanie by skončilo na fetch("/...") s hláškou "Failed to parse URL".
        // Presne tak dnes vypadol Register úpadcov (RU-MCP#8).
        this.base = normalizeBaseUrl(opts.baseUrl?.trim() || process.env.UVO_BASE_URL?.trim() || DEFAULT_BASE);
        this.fetchImpl = opts.fetchImpl ?? fetch;
        // Responses are large and one IČO query timed out at 30s before succeeding
        // at <70s — use a generous default timeout.
        this.timeoutMs = opts.timeoutMs ?? 90000;
        this.slowEmptyMs = opts.slowEmptyMs ?? SLOW_EMPTY_MS;
    }
    get canonicalOrigin() {
        return new URL(this.base).origin;
    }
    async withTimeout(fn) {
        const ctrl = new AbortController();
        let timer;
        const timeout = new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
                ctrl.abort();
                reject(new UvoSourceError("UVO_TIMEOUT", "UVO public source request timed out.", true));
            }, this.timeoutMs);
        });
        try {
            return await Promise.race([fn(ctrl.signal), timeout]);
        }
        catch (error) {
            if (error instanceof UvoSourceError)
                throw error;
            if (isAbortError(error))
                throw new UvoSourceError("UVO_TIMEOUT", "UVO public source request timed out.", true);
            throw new UvoSourceError("UVO_HTTP", "UVO public source request failed.", true);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    async acquireRequestSlot() {
        if (this.activeRequests >= UPSTREAM_CONCURRENCY)
            await new Promise((resolve) => this.waiters.push(resolve));
        this.activeRequests += 1;
    }
    releaseRequestSlot() {
        this.activeRequests -= 1;
        this.waiters.shift()?.();
    }
    /**
     * GET one HTML page. At most one same-origin redirect is followed. The
     * outage redirect (→ /errors/…), the outage page served with HTTP 200 and
     * HTTP 5xx are UVO_UNAVAILABLE; the missing-notice redirect (→ /404) and
     * HTTP 404 are UVO_NOT_FOUND — never a parsed, empty result.
     */
    async request(initialUrl, redirectAllowed) {
        const started = Date.now();
        return this.withTimeout(async (signal) => {
            let currentUrl;
            try {
                currentUrl = new URL(initialUrl);
            }
            catch {
                throw new UvoSourceError("UVO_INPUT", "UVO source URL is invalid.");
            }
            const initialOrigin = currentUrl.origin;
            for (let hop = 0; hop <= 1; hop += 1) {
                await this.acquireRequestSlot();
                try {
                    const response = await this.fetchImpl(currentUrl.href, {
                        method: "GET", redirect: "manual", headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, signal,
                    });
                    if (isRedirectStatus(response.status)) {
                        const location = response.headers.get("location");
                        if (!location)
                            throw new UvoSourceError("UVO_HTTP", "UVO public source redirect was rejected.");
                        let next;
                        try {
                            next = new URL(location, currentUrl);
                        }
                        catch {
                            throw new UvoSourceError("UVO_HTTP", "UVO public source redirect was rejected.");
                        }
                        if (next.origin !== initialOrigin || next.username || next.password)
                            throw new UvoSourceError("UVO_HTTP", "UVO public source redirect was rejected.");
                        if (next.pathname.startsWith("/errors/"))
                            throw new UvoSourceError("UVO_UNAVAILABLE", "UVO public source is temporarily unavailable.", true);
                        if (next.pathname === "/404")
                            throw new UvoSourceError("UVO_NOT_FOUND", "UVO public source has no such record.");
                        if (hop === 1 || (redirectAllowed && !redirectAllowed(next)))
                            throw new UvoSourceError("UVO_HTTP", "UVO public source redirect was rejected.");
                        currentUrl = next;
                        continue;
                    }
                    if (response.status === 404)
                        throw new UvoSourceError("UVO_NOT_FOUND", "UVO public source has no such record.");
                    if (response.status >= 500)
                        throw new UvoSourceError("UVO_UNAVAILABLE", "UVO public source is temporarily unavailable.", true);
                    if (response.status !== 200)
                        throw new UvoSourceError("UVO_HTTP", "UVO public source returned a non-success status.");
                    const contentType = response.headers.get("content-type") ?? "";
                    if (!/^text\/html(?:\s*;|$)/i.test(contentType))
                        throw new UvoSourceError("UVO_CONTENT_TYPE", "UVO public source returned an unsupported content type.");
                    const buffer = await readBoundedResponse(response, MAX_RESPONSE_BYTES);
                    const html = buffer.toString("utf8");
                    if (isUnavailablePage(html))
                        throw new UvoSourceError("UVO_UNAVAILABLE", "UVO public source is temporarily unavailable.", true);
                    return { html, finalUrl: currentUrl.href, elapsedMs: Date.now() - started };
                }
                finally {
                    this.releaseRequestSlot();
                }
            }
            throw new UvoSourceError("UVO_HTTP", "UVO public source redirect was rejected.");
        });
    }
    /** Build the search query string from params. */
    buildSearchUrl(params) {
        validateSearchParams(params);
        const qs = new URLSearchParams();
        if (params.ico)
            qs.set("obstarIco", params.ico);
        if (params.authorityName)
            qs.set("obstarNazov", params.authorityName);
        if (params.contractName)
            qs.set("nazovZakazky", params.contractName);
        if (params.cpv)
            qs.set("cpv", params.cpv);
        if (params.nuts)
            qs.set("nut", params.nuts);
        if (params.contractType)
            qs.set("druhZakazky", CONTRACT_TYPE_CODES[params.contractType]);
        if (params.updatedWithinDays)
            qs.set("datumAktualizacie", String(params.updatedWithinDays));
        if (params.pageSize && params.pageSize !== 20)
            qs.set("limit", String(params.pageSize));
        qs.set("page", String(params.page ?? 1));
        return `${this.base}${SEARCH_PATH}?${qs.toString()}`;
    }
    /** uvo_search: GET the server-rendered HTML results page and parse it. */
    async search(params) {
        validateSearchParams(params);
        const page = params.page ?? 1;
        const pageSize = params.pageSize ?? 20;
        const url = this.buildSearchUrl(params);
        const warnings = [];
        let { html, elapsedMs } = await this.request(url);
        if (isSlowEmpty(html, elapsedMs, this.slowEmptyMs)) {
            // The source's own time limit produces a false "no records" page; one retry usually succeeds.
            ({ html, elapsedMs } = await this.request(url));
            if (isSlowEmpty(html, elapsedMs, this.slowEmptyMs)) {
                throw new UvoSourceError("UVO_TIMEOUT", "UVO public source answered 'no records' only after its own time limit.", true);
            }
            warnings.push("source_slow_empty_retried");
        }
        verifySearchEcho(html, params, page, pageSize, warnings);
        const table = findResultsTable(html);
        let results;
        let resultCount;
        if (table) {
            results = parseTableRows(table, this.base);
            resultCount = validateSearchDocument(html, results, this.base, pageSize);
        }
        else if (NO_RECORDS_RE.test(html)) {
            if (page > 1)
                throw new UvoSourceError("UVO_PAGE_OUT_OF_RANGE", "UVO page is beyond the last result page.");
            results = [];
            resultCount = 0;
        }
        else {
            throw new UvoSourceError("UVO_SCHEMA", "UVO result table marker is missing.");
        }
        const pagination = parsePagination(html, page);
        const truncated = resultCount > results.length;
        return {
            query: pruneUndefined({ ...params, page }),
            resultCount,
            returnedCount: results.length,
            results,
            pagination,
            sourceUrl: url,
            page,
            pageSize,
            truncated,
            truncationReason: truncated ? "source_has_more_rows" : null,
            warnings,
        };
    }
    /** uvo_get_notice: GET the oznámenie detail HTML and extract structured fields. */
    async getNotice(noticeId) {
        if (!/^[1-9]\d{0,15}$/.test(noticeId))
            throw new UvoSourceError("UVO_INPUT", "Notice identifier is invalid.");
        const sourceUrl = `${this.base}${NOTICE_PATH}/${noticeId}`;
        const expectedPath = `${NOTICE_PATH}/${noticeId}`;
        const { html } = await this.request(sourceUrl, (target) => target.pathname === expectedPath && !target.search && !target.hash);
        return capNoticeDetail(parseNoticeDetail(html, noticeId, sourceUrl));
    }
}
function normalizeBaseUrl(value) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new UvoSourceError("UVO_INPUT", "UVO base URL is invalid.");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash)
        throw new UvoSourceError("UVO_INPUT", "UVO base URL is invalid.");
    return parsed.href.replace(/\/+$/, "");
}
function validateSearchParams(params) {
    const text = [params.authorityName, params.contractName, params.cpv, params.nuts];
    if (text.some((value) => value !== undefined && (!value.trim() || Buffer.byteLength(value, "utf8") > 256)))
        throw new UvoSourceError("UVO_INPUT", "UVO search input is invalid.");
    if (params.ico !== undefined && !/^\d{8}$/.test(params.ico))
        throw new UvoSourceError("UVO_INPUT", "IČO is invalid.");
    if (params.page !== undefined && (!Number.isSafeInteger(params.page) || params.page < 1 || params.page > MAX_SEARCH_PAGE))
        throw new UvoSourceError("UVO_INPUT", "UVO page is invalid.");
    if (!params.ico && !params.authorityName && !params.contractName && !params.cpv && !params.nuts)
        throw new UvoSourceError("UVO_INPUT", "UVO search criterion is required.");
}
/**
 * The paginator echoes the query the source actually ran. A different page,
 * page size or enumerated filter means the rows do not answer the request.
 */
function verifySearchEcho(html, params, page, pageSize, warnings) {
    const echo = parsePaginatorData(html);
    if (!echo)
        throw new UvoSourceError("UVO_SCHEMA", "UVO paginator data is missing.");
    if (String(echo.page) !== String(page))
        throw new UvoSourceError("UVO_SCHEMA", "UVO returned a different page than requested.");
    if (String(echo.limit) !== String(pageSize))
        throw new UvoSourceError("UVO_SCHEMA", "UVO returned a different page size than requested.");
    const strict = [
        ["obstarIco", params.ico],
        ["druhZakazky", params.contractType ? CONTRACT_TYPE_CODES[params.contractType] : undefined],
        ["datumAktualizacie", params.updatedWithinDays ? String(params.updatedWithinDays) : undefined],
    ];
    for (const [key, sent] of strict) {
        if (sent !== undefined && String(echo[key] ?? "") !== sent)
            throw new UvoSourceError("UVO_SCHEMA", "UVO did not apply the requested filter.");
    }
    const text = [
        ["obstarNazov", params.authorityName], ["nazovZakazky", params.contractName], ["cpv", params.cpv], ["nut", params.nuts],
    ];
    for (const [key, sent] of text) {
        if (sent !== undefined && String(echo[key] ?? "").trim().toLowerCase() !== sent.trim().toLowerCase())
            warnings.push(`source_filter_differs:${key}`);
    }
}
function validateSearchDocument(html, rows, base, pageSize) {
    const total = parseSourceTotal(html);
    if (typeof total !== "number")
        throw new UvoSourceError("UVO_SCHEMA", "UVO explicit result count is missing.");
    if (rows.length > total || (total > 0 && rows.length === 0) || rows.length > pageSize)
        throw new UvoSourceError("UVO_SCHEMA", "UVO result count contradicts the source count.");
    const seen = new Set();
    for (const row of rows) {
        if (!/^\d+$/.test(row.zakazkaId) || seen.has(row.zakazkaId))
            throw new UvoSourceError("UVO_SCHEMA", "UVO result identifier is invalid.");
        seen.add(row.zakazkaId);
        let detail;
        try {
            detail = new URL(row.detailUrl);
        }
        catch {
            throw new UvoSourceError("UVO_SCHEMA", "UVO result detail URL is invalid.");
        }
        const expectedOrigin = new URL(base).origin;
        if (detail.origin !== expectedOrigin || detail.pathname !== `${SEARCH_PATH}/detail/${row.zakazkaId}` || detail.username || detail.password || detail.hash || [...detail.searchParams.keys()].some((key) => key !== "cHash")) {
            throw new UvoSourceError("UVO_SCHEMA", "UVO result detail URL is invalid.");
        }
        if (row.authorityProfileId && !/^\d+$/.test(row.authorityProfileId))
            throw new UvoSourceError("UVO_SCHEMA", "UVO authority profile identifier is invalid.");
        for (const value of Object.values(row))
            if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_TEXT_FIELD_BYTES)
                throw new UvoSourceError("UVO_SCHEMA", "UVO result field exceeds its bound.");
    }
    return total;
}
function isSlowEmpty(html, elapsedMs, slowEmptyMs) {
    return elapsedMs >= slowEmptyMs && !findResultsTable(html) && NO_RECORDS_RE.test(html);
}
/** Cap notice text fields at MAX_TEXT_FIELD_BYTES and report every cut in warnings. */
function capNoticeDetail(detail) {
    const warnings = [...detail.warnings];
    const cap = (field, value) => {
        if (typeof value !== "string")
            throw new UvoSourceError("UVO_SCHEMA", "UVO public field is invalid.");
        if (Buffer.byteLength(value, "utf8") <= MAX_TEXT_FIELD_BYTES)
            return value;
        let output = value;
        while (Buffer.byteLength(output, "utf8") > MAX_TEXT_FIELD_BYTES)
            output = output.slice(0, -1);
        warnings.push(`field_truncated:${field}`);
        return output;
    };
    const opt = (field, value) => value === undefined ? undefined : cap(field, value);
    const money = (field, value) => {
        if (!value)
            return undefined;
        if (value.amount !== null && !Number.isFinite(value.amount))
            throw new UvoSourceError("UVO_SCHEMA", "UVO estimated value is invalid.");
        return { amount: value.amount, currency: value.currency === null ? null : cap(`${field}.currency`, value.currency), vat: value.vat === null ? null : cap(`${field}.vat`, value.vat) };
    };
    const operator = (value, index) => Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, opt(`awardedTo.${index}.${key}`, entry)]));
    const s = detail.subject;
    const capped = {
        noticeId: detail.noticeId,
        formFamily: detail.formFamily,
        noticeCode: opt("noticeCode", detail.noticeCode), vestnikNumber: opt("vestnikNumber", detail.vestnikNumber), publishedDate: opt("publishedDate", detail.publishedDate),
        noticeType: opt("noticeType", detail.noticeType), noticeSubtype: opt("noticeSubtype", detail.noticeSubtype),
        procedureType: opt("procedureType", detail.procedureType), contractType: opt("contractType", detail.contractType),
        contractingAuthority: Object.fromEntries(Object.entries(detail.contractingAuthority).map(([key, value]) => [key, opt(`contractingAuthority.${key}`, value)])),
        subject: {
            title: opt("subject.title", s.title), referenceNumber: opt("subject.referenceNumber", s.referenceNumber),
            mainCpv: opt("subject.mainCpv", s.mainCpv), mainCpvLabel: opt("subject.mainCpvLabel", s.mainCpvLabel),
            additionalCpv: s.additionalCpv.slice(0, 256).map((value, index) => cap(`subject.additionalCpv.${index}`, value)),
            shortDescription: opt("subject.shortDescription", s.shortDescription),
            estimatedValue: money("subject.estimatedValue", s.estimatedValue), finalValue: money("subject.finalValue", s.finalValue),
            placeNuts: opt("subject.placeNuts", s.placeNuts), placeNutsLabel: opt("subject.placeNutsLabel", s.placeNutsLabel),
        },
        awardedTo: detail.awardedTo?.slice(0, 256).map(operator),
        relatedZakazkaId: opt("relatedZakazkaId", detail.relatedZakazkaId), sourceUrl: detail.sourceUrl,
        warnings: [],
    };
    capped.warnings = warnings.map((warning) => cap("warnings", warning));
    return capped;
}
function isRedirectStatus(status) { return [301, 302, 303, 307, 308].includes(status); }
function isAbortError(error) {
    return error instanceof DOMException && error.name === "AbortError"
        || Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}
async function readBoundedResponse(response, maximumBytes) {
    const declared = response.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes))
        throw new UvoSourceError("UVO_SCHEMA", "UVO public source response exceeded its size bound.");
    if (!response.body)
        return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const next = await reader.read();
        if (next.done)
            break;
        const chunk = Buffer.from(next.value);
        total += chunk.length;
        if (total > maximumBytes) {
            void reader.cancel().catch(() => undefined);
            throw new UvoSourceError("UVO_SCHEMA", "UVO public source response exceeded its size bound.");
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
}
function pruneUndefined(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined && v !== "")
            out[k] = v;
    }
    return out;
}
