import * as cheerio from "cheerio";
function norm(s) {
    return s.replace(/\s+/g, " ").trim();
}
function renderTable($, $table) {
    const rows = [];
    $table.find("tr").each((_, tr) => {
        const cells = [];
        $(tr)
            .find("td, th")
            .each((__, cell) => {
            cells.push(norm($(cell).text()));
        });
        if (cells.length > 0)
            rows.push(cells);
    });
    if (rows.length === 0)
        return "";
    // Cells are not padded to a common width: Markdown does not need it, and
    // padding wide annex tables (e.g. the sadzobník of 145/1995) more than
    // doubled the output with spaces.
    const colWidths = [];
    for (const row of rows) {
        row.forEach((cell, i) => {
            colWidths[i] = Math.max(colWidths[i] ?? 0, cell.length);
        });
    }
    const lines = [];
    for (let i = 0; i < rows.length; i++) {
        lines.push("| " + rows[i].join(" | ") + " |");
        if (i === 0) {
            lines.push("| " + colWidths.map((w) => "-".repeat(Math.min(3, Math.max(1, w)))).join(" | ") + " |");
        }
    }
    return lines.join("\n");
}
// Reads text through the same document: cheerio.load(el) would re-parent the
// node into a new document and strip it (and its footnote links) from $par.
function getMainText($, $el) {
    return norm($el.children("div.text").toArray().map((el) => $(el).text()).join(" "));
}
function renderTrailingNode($, node, indent, lines) {
    if (node.type === "text") {
        const plain = norm($(node).text());
        if (plain)
            lines.push(" ".repeat(indent) + plain);
        return;
    }
    if (node.type !== "tag")
        return;
    if (node.name === "table") {
        for (const line of renderTable($, $(node)).split("\n")) {
            if (line)
                lines.push(" ".repeat(indent) + line);
        }
        return;
    }
    $(node).contents().each((_, child) => renderTrailingNode($, child, indent, lines));
}
function getTrailingContent($, $el, indent) {
    const lines = [];
    $el.children("div.text2").each((_, text2) => {
        $(text2).contents().each((__, node) => renderTrailingNode($, node, indent, lines));
    });
    return lines;
}
function labelFromId(prefix, id) {
    if (!id)
        return "";
    const m = id.match(new RegExp(`${prefix}-(\\d+)(?:\\b|$)`));
    return m ? m[1] : "";
}
function renderUnit($, el, indent, depth) {
    if (depth > 20)
        return [];
    const $el = $(el);
    const classList = ($el.attr("class") ?? "").split(/\s+/);
    const isOdsek = classList.includes("odsek");
    const isPismeno = classList.includes("pismeno");
    const isBod = classList.includes("bod");
    let label = "";
    if (isOdsek) {
        const $label = $el.children("div.odsekOznacenie").first();
        // An empty odsekOznacenie means the official text does not number this odsek
        // (single-odsek paragraphs). Inventing "(1)" there produces wrong citations
        // such as "§ 10 ods. 1 písm. a)"; only fall back to the id when the div is absent.
        if ($label.length > 0) {
            label = norm($label.text());
        }
        else {
            const num = labelFromId("odsek", $el.attr("id"));
            label = num ? `(${num})` : "(?)";
        }
    }
    else if (isPismeno) {
        label = norm($el.children("div.pismenoOznacenie").first().text()) || "?";
    }
    else if (isBod) {
        label = norm($el.children("div.bodOznacenie").first().text()) || "?";
    }
    const text = getMainText($, $el);
    const lines = [];
    if (label || text) {
        lines.push(`${" ".repeat(indent)}${[label, text].filter(Boolean).join(" ")}`.trimEnd());
    }
    const childSelector = [
        "div.odsek",
        "div.pismeno",
        "div.bod",
    ].join(", ");
    $el.children(childSelector).each((_, child) => {
        const childClasses = ($(child).attr("class") ?? "").split(/\s+/);
        const childIndent = childClasses.includes("bod") || childClasses.includes("pismeno") || childClasses.includes("odsek")
            ? indent + 2
            : indent + 2;
        lines.push(...renderUnit($, child, childIndent, depth + 1));
    });
    // Add trailing content (div.text2) AFTER child elements
    lines.push(...getTrailingContent($, $el, indent));
    return lines;
}
const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
function romanToNumber(input) {
    if (!/^[IVXLC]+$/i.test(input))
        return null;
    const digits = input.toUpperCase().split("").map((c) => ROMAN[c]);
    return digits.reduce((sum, value, i) => sum + (value < (digits[i + 1] ?? 0) ? -value : value), 0);
}
// "Čl. 5", "čl.5", "článok 5", "Čl. III" -> "5" / "3"; null for a paragraph reference.
function articleNumber(ref) {
    const m = ref.trim().match(/^(?:[čc]l(?:[áa]nok|\.)?)\s*([0-9]+[a-z]?|[IVXLC]+)\.?$/i);
    if (!m)
        return null;
    return /^\d/.test(m[1]) ? m[1].toLowerCase() : String(romanToNumber(m[1]));
}
function isContentNode($el) {
    return $el.closest("div.obsah").length === 0 && $el.closest("div.citat").length === 0;
}
// Finds a paragraph ("13", "§ 13") or an article ("Čl. 5") of the law itself.
// Paragraphs quoted inside an amendment (div.citat) belong to the amended law
// and are deliberately not returned; see findQuotedParagraf.
export function extractParagrafFromPortalHtml(portalHtml, paragrafId) {
    const $ = cheerio.load(portalHtml);
    const article = articleNumber(paragrafId);
    if (article) {
        const $art = $("div.ustavnyclanok, div.clanok").filter((_, el) => {
            const id = $(el).attr("id") ?? "";
            return (id === `ustavnyclanok-${article}` || new RegExp(`(?:^|\\.)clanok-${article}$`).test(id)) && isContentNode($(el));
        });
        return $art.length ? { $, $par: $art.first() } : null;
    }
    const id = paragrafId.replace(/^§/i, "").trim().replace(/\s+/g, "").toLowerCase();
    const $par = $("div.paragraf").filter((_, el) => $(el).attr("id") === `paragraf-${id}` && isContentNode($(el)));
    if ($par.length === 0)
        return null;
    return { $, $par: $par.first() };
}
// When "§ N" exists only as quoted text of an amendment, reports the article
// that quotes it and the law that article amends (from the article's lead text).
export function findQuotedParagraf(portalHtml, paragrafId) {
    const $ = cheerio.load(portalHtml);
    const id = paragrafId.replace(/^§/i, "").trim().replace(/\s+/g, "").toLowerCase();
    const $quoted = $("div.paragraf")
        .filter((_, el) => $(el).attr("id") === `paragraf-${id}` && $(el).closest("div.citat").length > 0)
        .first();
    if ($quoted.length === 0)
        return null;
    const $article = $quoted.closest("div.clanok");
    const lead = norm($article.find("div.text").first().text());
    const target = lead.match(/[čc]\.\s*(\d+)\s*\/\s*(\d{4})/);
    return {
        article: norm($article.children("div.clanokOznacenie").first().text()),
        targetLaw: target ? `${target[1]}/${target[2]}` : undefined,
    };
}
export function renderParagraf($, $par) {
    if ($par.hasClass("clanok"))
        return renderArticle($, $par.get(0));
    const ozn = norm($par.children("div.paragrafOznacenie, div.ustavnyclanokOznacenie").first().text());
    const nadpis = norm($par.children("div.paragrafNadpis, div.ustavnyclanokNadpis").first().text());
    const header = [ozn, nadpis ? `- ${nadpis}` : ""].join(" ").trim();
    const lines = [header];
    const directText = getMainText($, $par);
    if (directText)
        lines.push(directText);
    const childSelector = ["div.odsek", "div.pismeno", "div.bod"].join(", ");
    $par.children(childSelector).each((_, el) => {
        lines.push(...renderUnit($, el, 0, 0));
    });
    lines.push(...getTrailingContent($, $par, 0));
    return lines.filter(Boolean).join("\n");
}
// Same-law references that Slov-Lex itself links ("#paragraf-9"), including
// "§ 5 a 6" style anchor text. Quoted amendment text is ignored.
export function extractLinkedParagraphReferences($, $par) {
    const refs = new Set();
    $par.find("a[href^='#paragraf-']").each((_, a) => {
        if ($(a).closest("div.citat").length > 0)
            return;
        const target = ($(a).attr("href") ?? "").match(/^#paragraf-([0-9]+[a-z]{0,3})/i);
        if (target)
            refs.add(target[1].toLowerCase());
        for (const ref of extractParagraphReferences(norm($(a).text())))
            refs.add(ref);
    });
    return Array.from(refs);
}
// True when a top-level odsek carries an empty odsekOznacenie, i.e. the official
// text does not number it and citations must skip "ods.".
export function hasUnnumberedOdsek($, $par) {
    return unnumberedOdseky($, $par).length > 0;
}
function unnumberedOdseky($, $par) {
    return $par
        .children("div.odsek")
        .toArray()
        .filter((el) => {
        const $label = $(el).children("div.odsekOznacenie").first();
        return $label.length > 0 && !norm($label.text());
    });
}
// Citation hint for a paragraph whose odsek is unnumbered. Only suggests
// "písm." when the unnumbered odsek actually contains lettered units.
export function unnumberedOdsekCitationHint($, $par, paragraphRef) {
    const odseky = unnumberedOdseky($, $par);
    if (odseky.length === 0)
        return null;
    const hasLetters = odseky.some((el) => $(el).children("div.pismeno").length > 0);
    const preferred = hasLetters ? `„§ ${paragraphRef} písm. …“` : `„§ ${paragraphRef}“`;
    return `Citácia: odsek nie je číslovaný – cituj ${preferred}, nie „§ ${paragraphRef} ods. 1“.`;
}
// Slov-Lex marks units that a later, already published amendment changes or
// repeals with the toBeModified / toBeDeleted classes.
export function hasPendingChange($par) {
    const selector = ".toBeModified, .toBeDeleted";
    return $par.is(selector) || $par.find(selector).length > 0;
}
function normalizeParagraphNumber(input) {
    return input.replace(/^§\s*/i, "").trim();
}
function expandParagraphRange(startRaw, endRaw) {
    const start = normalizeParagraphNumber(startRaw).match(/^(\d+)([a-zA-Z]?)$/);
    const end = normalizeParagraphNumber(endRaw).match(/^(\d+)([a-zA-Z]?)$/);
    if (!start || !end)
        return [];
    const startNumber = Number(start[1]);
    const endNumber = Number(end[1]);
    if (start[2] || end[2]) {
        if (start[1] !== end[1] || !start[2] || !end[2])
            return [];
        const a = start[2].toLowerCase().charCodeAt(0);
        const b = end[2].toLowerCase().charCodeAt(0);
        if (b < a || b - a > 24)
            return [];
        return Array.from({ length: b - a + 1 }, (_, idx) => `${start[1]}${String.fromCharCode(a + idx)}`);
    }
    if (endNumber < startNumber || endNumber - startNumber > 24)
        return [];
    return Array.from({ length: endNumber - startNumber + 1 }, (_, idx) => String(startNumber + idx));
}
export function extractParagraphReferences(text) {
    const refs = new Set();
    // Blank out every "§ N" that belongs to another law (a "zákona č. N/RRRR"
    // citation, a code such as "Obchodného zákonníka", or "zákona o …"), including
    // enumerations like "§ 4 …, § 10 … a § 58 zákona č. 366/1999".
    const { masked: maskedCitations } = analyzeCitations(text);
    // A sentence that cites another law by "§ N" and has no "§ N … tohto zákona" is
    // ambiguous for its remaining "§" ("podľa § 4 …, § 13 ods. 3 až 7 a úľavy
    // podľa § 16 … zákona č. 366/1999"). Missing a link is safer than attaching a
    // paragraph of the wrong law, so such sentences contribute no same-law refs.
    let masked = maskedCitations;
    const sentenceBreak = /[.;]\s+(?=[A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ(]|\(\d)|\n/g;
    let sentenceStart = 0;
    const boundaries = [...Array.from(text.matchAll(sentenceBreak), (m) => (m.index ?? 0) + m[0].length), text.length];
    for (const end of boundaries) {
        const original = text.slice(sentenceStart, end);
        const current = masked.slice(sentenceStart, end);
        if (current !== original && !/§\s*\d+[a-z]{0,3}[^§;]{0,40}?tohto\s+z[áa]kon/i.test(original)) {
            masked = masked.slice(0, sentenceStart) + current.replace(/§/g, " ") + masked.slice(end);
        }
        sentenceStart = end;
    }
    const rangeRegex = /§\s*(\d+[a-zA-Z]?)(?:\s*a(?:ž|z)\s*|\s*-\s*)§?\s*(\d+[a-zA-Z]?)/gi;
    for (const match of masked.matchAll(rangeRegex)) {
        for (const ref of expandParagraphRange(match[1], match[2])) {
            refs.add(ref);
        }
    }
    const singleRegex = /§\s*(\d+[a-zA-Z]?)/g;
    for (const match of masked.matchAll(singleRegex)) {
        refs.add(normalizeParagraphNumber(match[1]));
    }
    return Array.from(refs);
}
export const KODEX_ALIASES = {
    "Zákonník práce": {
        number: "311",
        year: "2001",
        pattern: /Z[áa]konn[íi]k(?:a|u|om)?\s+pr[áa]ce/i,
    },
    "Občiansky zákonník": {
        number: "40",
        year: "1964",
        pattern: /Ob[čc]iansk(?:y|eho|emu|om|ym)\s+z[áa]konn[íi]k(?:a|u|om)?/i,
    },
    "Obchodný zákonník": {
        number: "513",
        year: "1991",
        pattern: /Obchodn(?:[ýy]|[ée]ho|[ée]mu|om|[ýy]m)\s+z[áa]konn[íi]k(?:a|u|om)?/i,
    },
    "Daňový poriadok": {
        number: "563",
        year: "2009",
        pattern: /Da[ňn]ov(?:[ýy]|[ée]ho|[ée]mu|om|[ýy]m)\s+poriad(?:ok|ku|kom)/i,
    },
    "Trestný zákon": {
        number: "300",
        year: "2005",
        pattern: /Trestn(?:[ýy]|[ée]ho|[ée]mu|om|[ýy]m)\s+z[áa]kon(?:a|u|e|om)?(?!n[íi]k)/i,
    },
    "Trestný poriadok": {
        number: "301",
        year: "2005",
        pattern: /Trestn(?:[ýy]|[ée]ho|[ée]mu|om|[ýy]m)\s+poriad(?:ok|ku|kom)/i,
    },
    "Správny poriadok": {
        number: "71",
        year: "1967",
        pattern: /Spr[áa]vn(?:[yý]|[ée]ho|[ée]mu|om|[yý]m)\s+poriad(?:ok|ku|kom)/i,
    },
    "Civilný sporový poriadok": {
        number: "160",
        year: "2015",
        pattern: /Civiln(?:[yý]|[ée]ho|[ée]mu|om|[yý]m)\s+sporov(?:[yý]|[ée]ho|[ée]mu|om|[yý]m)\s+poriad(?:ok|ku|kom)/i,
    },
};
// "zákona č. 461/2003 Z. z.", "zákon Národnej rady Slovenskej republiky č. 171/1993 Z. z.".
const LAW_CITATION_SOURCE = String.raw `z[áa]kon(?:a|om|u|e)?\s+(?:N[áa]rodnej\s+rady\s+Slovenskej\s+republiky\s+|Slovenskej\s+n[áa]rodnej\s+rady\s+)?[čc]\.?\s*(\d+)\s*\/\s*(\d{4})\s*(?:Z\.?\s*z\.?|Zb\.?)`;
// A law named by its subject ("§ 5 zákona o dani z pridanej hodnoty"): it is
// clearly another law, but its number is unknown, so it is only masked.
const NAMED_LAW_SOURCE = String.raw `z[áa]kona\s+o\s`;
// Tokens that may sit between "§ N" and the law it belongs to: subdivisions,
// numbers, letters and enumeration connectors ("§ 4 ods. 1 písm. d), § 10 …").
const QUALIFIER_REGEX = /^(?:\s+|,|(?:ods\.|odsek(?:u|och|ov|y|mi|om)?|p[íi]sm\.|p[íi]smen(?:o|a|á|u|e)?|bod(?:u|ov|y|och|e)?|prv\S*|druh\S*|tret\S*|[šs]tvrt\S*|piat\S*|[šs]iest\S*|siedm\S*|[ôo]sm\S*|deviat\S*|desiat\S*|vet[ay]?|\d+[a-z]{0,3}\)?|[a-z]{1,2}\)|a[žz]|alebo|a)(?=[\s,]|$))/i;
function matchExternalMarker(rest) {
    const law = rest.match(new RegExp(`^${LAW_CITATION_SOURCE}`, "i"));
    if (law)
        return { kind: "law", number: law[1], year: law[2], length: law[0].length };
    for (const [label, entry] of Object.entries(KODEX_ALIASES)) {
        const alias = rest.match(new RegExp(`^(?:${entry.pattern.source})`, "i"));
        if (alias)
            return { kind: "alias", number: entry.number, year: entry.year, alias: label, length: alias[0].length };
    }
    const named = rest.match(new RegExp(`^${NAMED_LAW_SOURCE}`, "i"));
    if (named)
        return { kind: "named", length: named[0].length };
    return null;
}
// Splits the "§ N" references in a text into references to another law and
// the rest, which are references to the law the text belongs to.
function analyzeCitations(text) {
    const sections = Array.from(text.matchAll(/§\s*(\d+[a-zA-Z]?)/g), (m) => ({
        paragraph: m[1],
        start: m.index ?? 0,
        end: (m.index ?? 0) + m[0].length,
    }));
    const owner = sections.map(() => null);
    for (let i = sections.length - 1; i >= 0; i -= 1) {
        const gapEnd = i + 1 < sections.length ? sections[i + 1].start : text.length;
        let rest = text.slice(sections[i].end, gapEnd);
        for (;;) {
            const qualifier = rest.match(QUALIFIER_REGEX);
            if (!qualifier || qualifier[0].length === 0)
                break;
            rest = rest.slice(qualifier[0].length);
        }
        const marker = matchExternalMarker(rest);
        if (marker)
            owner[i] = marker;
        else if (!rest && i + 1 < sections.length)
            owner[i] = owner[i + 1];
    }
    let masked = text;
    const cross = [];
    sections.forEach((section, i) => {
        const marker = owner[i];
        if (!marker)
            return;
        masked = masked.slice(0, section.start) + " ".repeat(section.end - section.start) + masked.slice(section.end);
        if (marker.kind === "law")
            cross.push({ number: marker.number, year: marker.year, paragraph: section.paragraph, source: "inline" });
        if (marker.kind === "alias") {
            cross.push({ number: marker.number, year: marker.year, paragraph: section.paragraph, source: "alias", alias: marker.alias });
        }
    });
    // Bare law citations without a "§" ("podľa zákona č. 283/2002 Z. z.").
    for (const match of text.matchAll(new RegExp(LAW_CITATION_SOURCE, "gi"))) {
        cross.push({ number: match[1], year: match[2], paragraph: undefined, source: "inline" });
    }
    return { masked, cross };
}
export function extractCrossLawReferences(text) {
    const { cross } = analyzeCitations(text);
    const withParagraph = new Set(cross.filter((r) => r.paragraph).map((r) => `${r.number}/${r.year}`));
    const refs = [];
    const seen = new Set();
    for (const ref of cross) {
        // A bare citation adds nothing when the same law is already cited with a §.
        if (!ref.paragraph && withParagraph.has(`${ref.number}/${ref.year}`))
            continue;
        const key = `${ref.number}/${ref.year}#${ref.paragraph ?? ""}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        refs.push(ref);
    }
    return refs;
}
// Footnote markers of a unit, read from the HTML: Slov-Lex links them to
// "#poznamky.poznamka-N" and renders the number as <sup>. Reading the rendered
// text instead would mistake "(§ 8)" for footnote 8).
export function extractFootnoteMarkers($, $par) {
    const markers = new Set();
    $par.find("a[href*='poznamky.poznamka-']").each((_, a) => {
        const marker = ($(a).attr("href") ?? "").replace(/^.*poznamky\.poznamka-/, "").trim();
        if (marker)
            markers.add(marker);
    });
    // Some markers are a bare <sup>N</sup>) without the link.
    $par.find("sup").each((_, sup) => {
        if ($(sup).closest("a").length > 0)
            return;
        const next = sup.next;
        const following = next && next.type === "text" ? $(next).text() : "";
        const marker = norm($(sup).text());
        if (/^\d{1,3}[a-z]{0,3}$/.test(marker) && following.startsWith(")"))
            markers.add(marker);
    });
    return Array.from(markers);
}
export function resolveFootnoteReferences(markersOrText, footnotes) {
    const refs = [];
    const seen = new Set();
    // Prefer markers from extractFootnoteMarkers. For plain text, a marker must be
    // glued to the preceding word ("predpisu15)"), so "(§ 8)" or "písm. a) b)" do
    // not count.
    const markers = Array.isArray(markersOrText)
        ? markersOrText
        : Array.from(markersOrText.matchAll(/(?<=[^\s\d(§])(\d{1,3}[a-z]{0,3})\)/g), (m) => m[1]);
    for (const marker of markers) {
        const noteText = footnotes[marker];
        if (!noteText)
            continue;
        const noteRefs = extractCrossLawReferences(noteText);
        for (const ref of noteRefs) {
            const key = `${ref.number}/${ref.year}#${ref.paragraph ?? ""}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            refs.push({ ...ref, source: "footnote" });
        }
    }
    return refs;
}
export function extractFootnoteDefinitions(portalHtml) {
    const $ = cheerio.load(portalHtml);
    const notes = {};
    $("div.poznamka, div.footnote").each((_, el) => {
        const $note = $(el);
        const markerRaw = norm($note.children(".poznamkaOznacenie").first().text()) ||
            norm($note.find(".poznamkaOznacenie").first().text()) ||
            norm($note.attr("id")?.replace(/^.*poznamka-?/i, "") ?? "");
        const marker = markerRaw.replace(/[)\s.]+$/g, "").trim();
        if (!marker)
            return;
        const text = norm($note.children("div.poznamkaText, div.text").first().text()) ||
            norm($note.find("div.poznamkaText, div.text").first().text()) ||
            norm($note.clone().children(".poznamkaOznacenie").remove().end().text());
        if (text)
            notes[marker] = text;
    });
    return notes;
}
// Returns a character window over an already-assembled string, with the same
// metadata shape as renderWholeLawTextChunk. Used to page large tool outputs
// (e.g. a single big paragraph plus its cross-references) so one result never
// exceeds the client's per-tool-result token limit.
export function sliceWindow(full, maxChars, offsetChars = 0) {
    const totalChars = full.length;
    const start = Math.max(0, Math.min(offsetChars, totalChars));
    const text = full.slice(start, start + Math.max(1, maxChars));
    const returnedChars = text.length;
    return {
        text,
        totalChars,
        offsetChars: start,
        returnedChars,
        hasMore: start + returnedChars < totalChars,
    };
}
export function renderWholeLawText(portalHtml, maxChars) {
    const chunk = renderWholeLawTextChunk(portalHtml, { maxChars, offsetChars: 0 });
    if (!chunk.hasMore)
        return { text: chunk.text, truncated: false };
    return { text: `${chunk.text}\n\n…(truncated to ${maxChars} chars)…`, truncated: true };
}
function renderArticle($, article) {
    const lines = [];
    // Walk blocks in source order: amendments interleave quotes, text2 and points.
    // Read inline markup together so superscripts and punctuation stay attached.
    function visit(node) {
        const $node = $(node);
        if ($node.is("script, style"))
            return;
        if ($node.is("table")) {
            lines.push(renderTable($, $node));
        }
        else if ($node.find("div, p, table").length === 0) {
            const text = norm($node.clone().find("br").replaceWith(" ").end().text());
            if (text)
                lines.push(text);
        }
        else {
            $node.contents().each((_, child) => visit(child));
        }
    }
    visit(article);
    return lines.filter(Boolean).join("\n");
}
// Relative links in a .portal page resolve against /static/SK/ZZ/<year>/<number>/.
const PORTAL_BASE_URL = "https://static.slov-lex.sk/static/SK/ZZ/0000/0/version.portal";
function renderLeaf($, $node) {
    return norm($node.clone().find("br").replaceWith(" ").end().text());
}
// Walks a content subtree in document order. Paragraphs, articles and footnotes
// become their own blocks; everything else (part/title headings, annex items,
// free text) is kept as plain lines so nothing in the source is dropped.
function renderContentTree($, root, blocks) {
    let run = [];
    const flush = () => {
        if (run.length)
            blocks.push(run.join("\n"));
        run = [];
    };
    const block = (text) => {
        flush();
        if (text.trim())
            blocks.push(text.trim());
    };
    function visit(node) {
        if (node.type === "text") {
            const text = norm($(node).text());
            if (text)
                run.push(text);
            return;
        }
        if (node.type !== "tag")
            return;
        const $node = $(node);
        if ($node.is("script, style"))
            return;
        if ($node.is("div.paragraf, div.ustavnyclanok"))
            return block(renderParagraf($, $node));
        if ($node.is("div.clanok"))
            return block(renderArticle($, node));
        if ($node.is("div.poznamka")) {
            const label = norm($node.children("div.poznamkaOznacenie").first().text());
            const text = norm($node.children().not("div.poznamkaOznacenie").text());
            return block([label, text].filter(Boolean).join(" "));
        }
        if ($node.is("table"))
            return block(renderTable($, $node));
        if ($node.is("a.predpis-pdf-priloha")) {
            const href = $node.attr("href") ?? "";
            const url = href ? new URL(href, PORTAL_BASE_URL).href : "";
            run.push(`[${renderLeaf($, $node) || "Príloha"} – v Slov-Lexe je len ako PDF, jej obsah nie je v tomto texte: ${url}]`);
            return;
        }
        if ($node.find("div, p, table, a.predpis-pdf-priloha").length === 0) {
            const text = renderLeaf($, $node);
            if (text)
                run.push(text);
            return;
        }
        $node.contents().each((_, child) => visit(child));
    }
    visit(root);
    flush();
}
function renderLegacyParagraphs($) {
    const parts = [];
    $("div.paragraf, div.clanok, div.ustavnyclanok").each((_, el) => {
        const $par = $(el);
        // Slov-Lex portal HTML contains two div.paragraf trees: a navigation
        // table-of-contents (inside div.obsah, marked paragrafOznacenie.index_element,
        // with empty bodies) and the real content tree. Skip the TOC, otherwise the
        // whole-law output leads with a large empty skeleton before any real text.
        if ($par.closest("div.obsah").length > 0)
            return;
        if ($par.children("div.paragrafOznacenie, div.clanokOznacenie").hasClass("index_element"))
            return;
        // Nested paragraphs/articles are already included in their parent article.
        if ($par.parents("div.clanok").length > 0)
            return;
        const text = $par.hasClass("clanok") ? renderArticle($, el) : renderParagraf($, $par);
        if (text.trim())
            parts.push(text.trim());
    });
    return parts;
}
// Renders the full text of a law: the body (with part/title headings), the
// annexes (#prilohy) and the footnotes (#poznamky), in that order.
export function renderWholeLawFullText(portalHtml) {
    const $ = cheerio.load(portalHtml);
    const $root = $("div.predpis").filter((_, el) => $(el).closest("div.obsah").length === 0).first();
    let parts;
    if ($root.length === 0) {
        parts = renderLegacyParagraphs($);
    }
    else {
        parts = [];
        const hasBody = $root.find("div.paragraf, div.clanok, div.ustavnyclanok, div.odsek, div.bod, div.blokTextu").length > 0;
        if (hasBody)
            renderContentTree($, $root.get(0), parts);
        const $prilohy = $("div.prilohy").filter((_, el) => $(el).closest("div.obsah").length === 0).first();
        if ($prilohy.length && norm($prilohy.text())) {
            parts.push("PRÍLOHY");
            renderContentTree($, $prilohy.get(0), parts);
        }
        const $poznamky = $("div.poznamky").filter((_, el) => $(el).closest("div.obsah").length === 0).first();
        if ($poznamky.find("div.poznamka").length) {
            parts.push("Poznámky pod čiarou");
            renderContentTree($, $poznamky.get(0), parts);
        }
        if (!hasBody)
            parts = [];
    }
    const full = parts.join("\n\n");
    if (!full)
        throw new Error("Nepodarilo sa extrahovať text predpisu z HTML Slov-Lex. Prázdny výsledok nie je úplné znenie; overte zdrojový dokument.");
    return full;
}
export function renderWholeLawTextChunk(portalHtml, options) {
    const full = renderWholeLawFullText(portalHtml);
    const maxChars = options.maxChars;
    const offsetChars = Math.max(0, Math.min(options.offsetChars ?? 0, full.length));
    const text = full.slice(offsetChars, offsetChars + maxChars);
    const returnedChars = text.length;
    const hasMore = offsetChars + returnedChars < full.length;
    return {
        text,
        totalChars: full.length,
        offsetChars,
        returnedChars,
        hasMore,
    };
}
