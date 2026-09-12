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
    // Calculate column widths
    const colWidths = [];
    for (const row of rows) {
        row.forEach((cell, i) => {
            colWidths[i] = Math.max(colWidths[i] ?? 0, cell.length);
        });
    }
    // Render table as text
    const lines = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const paddedCells = row.map((cell, j) => cell.padEnd(colWidths[j]));
        lines.push("| " + paddedCells.join(" | ") + " |");
        // Add separator after header row
        if (i === 0) {
            lines.push("| " + colWidths.map((w) => "-".repeat(w)).join(" | ") + " |");
        }
    }
    return lines.join("\n");
}
function getMainText($el) {
    return norm($el.children("div.text").toArray().map((el) => cheerio.load(el).text()).join(" "));
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
        label = norm($el.children("div.odsekOznacenie").first().text());
        if (!label) {
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
    const text = getMainText($el);
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
export function extractParagrafFromPortalHtml(portalHtml, paragrafId) {
    const $ = cheerio.load(portalHtml);
    const id = paragrafId.replace(/^§/i, "").trim().replace(/\s+/g, "");
    const cssId = `paragraf-${id.toLowerCase()}`;
    const $par = $(`div.paragraf#${cssId}`);
    if ($par.length === 0)
        return null;
    return { $, $par: $par.first() };
}
export function renderParagraf($, $par) {
    const ozn = norm($par.children("div.paragrafOznacenie").first().text());
    const nadpis = norm($par.children("div.paragrafNadpis").first().text());
    const header = [ozn, nadpis ? `- ${nadpis}` : ""].join(" ").trim();
    const lines = [header];
    const directText = norm($par.children("div.text").toArray().map((el) => cheerio.load(el).text()).join(" "));
    if (directText)
        lines.push(directText);
    const childSelector = ["div.odsek", "div.pismeno", "div.bod"].join(", ");
    $par.children(childSelector).each((_, el) => {
        lines.push(...renderUnit($, el, 0, 0));
    });
    lines.push(...getTrailingContent($, $par, 0));
    return lines.filter(Boolean).join("\n");
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
    const masked = text.replace(LAW_CITATION_REGEX, (full) => " ".repeat(full.length));
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
const LAW_CITATION_REGEX = /(?:§\s*(\d+[a-zA-Z]?)[^§\n]{0,40}?)?z[áa]kona?\s+[čc]\.?\s*(\d+)\s*\/\s*(\d{4})\s*(?:Z\.?\s*z\.?|Zb\.?)/gi;
export function extractCrossLawReferences(text) {
    const refs = [];
    const seen = new Set();
    for (const match of text.matchAll(LAW_CITATION_REGEX)) {
        const paragraph = match[1];
        const number = match[2];
        const year = match[3];
        const key = `${number}/${year}#${paragraph ?? ""}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        refs.push({ number, year, paragraph, source: "inline" });
    }
    for (const [label, entry] of Object.entries(KODEX_ALIASES)) {
        const aliasFlags = entry.pattern.flags.includes("g")
            ? entry.pattern.flags
            : entry.pattern.flags + "g";
        const aliasRegex = new RegExp(String.raw `§\s*(\d+[a-zA-Z]?)\s+` + entry.pattern.source, aliasFlags);
        for (const match of text.matchAll(aliasRegex)) {
            const paragraph = match[1];
            const key = `${entry.number}/${entry.year}#${paragraph}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            refs.push({
                number: entry.number,
                year: entry.year,
                paragraph,
                source: "alias",
                alias: label,
            });
        }
    }
    return refs;
}
export function resolveFootnoteReferences(paraText, footnotes) {
    const refs = [];
    const seen = new Set();
    const markerRegex = /(?<![\d(])(\d{1,3}[a-z]{0,3})\s*\)/g;
    for (const match of paraText.matchAll(markerRegex)) {
        const marker = match[1];
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
export function renderWholeLawTextChunk(portalHtml, options) {
    const $ = cheerio.load(portalHtml);
    const parts = [];
    $("div.paragraf").each((_, el) => {
        const $par = $(el);
        // Slov-Lex portal HTML contains two div.paragraf trees: a navigation
        // table-of-contents (inside div.obsah, marked paragrafOznacenie.index_element,
        // with empty bodies) and the real content tree. Skip the TOC, otherwise the
        // whole-law output leads with a large empty skeleton before any real text.
        if ($par.closest("div.obsah").length > 0)
            return;
        if ($par.children("div.paragrafOznacenie").hasClass("index_element"))
            return;
        const text = renderParagraf($, $par);
        if (text.trim())
            parts.push(text.trim());
    });
    const full = parts.join("\n\n");
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
