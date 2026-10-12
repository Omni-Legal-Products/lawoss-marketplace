// Slovak headings are matched case-insensitively, ignoring diacritics & punctuation.
// Each pattern is tried against a "normalized" form of the heading title.
const MATCHERS = [
    { key: "predmet", patterns: [/\bpredmet(\s+(zmluvy|dohody|kupy))?\b/, /\buvodne ustanovenia\b/] },
    { key: "cena", patterns: [/\b(cena|kupna cena|odmena|cena diela|cena za dielo)\b/] },
    { key: "platobne_podmienky", patterns: [/\bplatobne podmienky\b/, /\bfakturacia\b/, /\bsposob platby\b/] },
    { key: "sankcie", patterns: [/\bsankcie\b/, /\bsankcn/, /\bzmluvne pokuty\b/, /\buroky z omeskania\b/] },
    { key: "doba_a_ukoncenie", patterns: [/\bdoba (trvania|platnosti)\b/, /\btrvanie\b/, /\bukoncenie zmluvy\b/, /\bskoncenie zmluvy\b/, /\bvypoved\b/, /\bodstupenie\b/] },
    { key: "rozhodne_pravo", patterns: [/\brozhodne pravo\b/, /\briesenie sporov\b/, /\baplikovatelne pravo\b/] },
    { key: "zaverecne_ustanovenia", patterns: [/\bzaverecne ustanovenia\b/, /\bvseobecne ustanovenia\b/, /\bspolocne ustanovenia\b/] },
    { key: "prilohy", patterns: [/\bprilohy\b/, /\bzoznam priloh\b/] },
];
// Phrases in the body text that suggest a category exists even when no heading
// was recognized for it. Used only to warn, never to fill a category.
const INDICATORS = {
    predmet: /predmetom (tejto )?(zmluvy|dohody)/i,
    cena: /(kúpna cena|cena (diela|za)|odmen[auy])/i,
    platobne_podmienky: /(splatnos\S*|faktúr\S*)/i,
    sankcie: /(zmluvn\S* pokut\S*|úrok\S* z omeškania|sankci\S*)/i,
    doba_a_ukoncenie: /(na dobu (ne)?určitú|výpove\S*|odstúpi\S*)/i,
    rozhodne_pravo: /(právnym poriadkom|rozhodné právo|príslušný súd)/i,
    prilohy: /príloh[ay] č\./i,
};
function normalizeHeading(s) {
    return s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
// "Článok I.", "Článok 3 – Cena", "Čl. IV", "Časť II.", "§ 5 Sankcie". A numbering
// token is required so prose such as "Časť dotácie …" is not a heading.
const ARTICLE_RE = /^(?:článok|clanok|čl\.|cl\.|časť|cast)\s*([IVXLCDM]+|\d+)(?![\p{L}\d])\.?\s*[—–:\-]?\s*(.*)$/iu;
const PARAGRAPH_SIGN_RE = /^§\s*(\d+[a-z]?)\.?\s*[—–:\-]?\s*(.*)$/iu;
const ROMAN_RE = /^([IVXLCDM]{1,5})[.)]\s*(.*)$/u;
const NUMBERED_RE = /^(\d{1,2})[.)]\s+(.+)$/u;
// PDF text layers interleave page markers such as "-- 5 of 8 --" or "6/7".
const PAGE_MARKER_RE = /^(--\s*\d+\s+of\s+\d+\s*--|\d+\s*\/\s*\d+)$/i;
const KEYWORD_TITLE_RE = /^(predmet|cena|odmena|platobn[éeê]\s+podmienky|sankcie|zmluvn[ée]\s+pokut|doba|trvanie|ukon[čc]enie|skon[čc]enie|rozhodn[ée]\s+pr[áa]vo|z[áa]vere[čc]n[ée]|spolo[čc]n[ée]|prilohy|pr[íi]lohy|zoznam\s+pr[íi]loh)\b/i;
/** A short, title-shaped line: not a sentence, not a list item or numbered paragraph. */
function isTitleLike(s) {
    const t = s.trim();
    if (!t || t.length > 100)
        return false;
    if (!/^\p{Lu}/u.test(t))
        return false;
    if (/[,;:]$/.test(t))
        return false;
    const words = t.split(/\s+/).length;
    if (words > 10)
        return false;
    if (/\.$/.test(t) && words > 6)
        return false;
    return true;
}
function isAllCapsHeading(t) {
    if (!/^\p{Lu}/u.test(t))
        return false;
    // "IČ DPH:" / "IČO:" are field labels of the parties block, not headings.
    if (/:\s*$/.test(t) && t.split(/\s+/).length <= 2)
        return false;
    if (t !== t.toUpperCase() || t === t.toLowerCase())
        return false;
    const letters = (t.match(/\p{L}/gu) ?? []).length;
    const nonSpace = t.replace(/\s/g, "").length;
    return letters >= 4 && letters / nonSpace >= 0.6 && t.split(/\s+/).length <= 12;
}
/** Next non-empty line after `i` that is not a PDF page marker (looks at most 4 lines ahead). */
function nextContentLine(lines, i) {
    for (let j = i + 1; j < lines.length && j <= i + 4; j++) {
        const t = lines[j].trim();
        if (!t || PAGE_MARKER_RE.test(t))
            continue;
        return j;
    }
    return undefined;
}
/** Heading whose number stands alone ("Článok III.") takes its title from the next line. */
function numberedHeading(lines, i, label, rest) {
    const r = rest.trim();
    if (r)
        return isTitleLike(r) ? { title: r, bodyLine: i + 1 } : undefined;
    const j = nextContentLine(lines, i);
    if (j !== undefined && isTitleLike(lines[j]) && !NUMBERED_RE.test(lines[j].trim())) {
        return { title: lines[j].trim(), bodyLine: j + 1 };
    }
    return { title: label, bodyLine: i + 1 };
}
function findHeadings(lines) {
    const isArticle = (t) => {
        const m = ARTICLE_RE.exec(t) ?? PARAGRAPH_SIGN_RE.exec(t);
        return !!m && (!m[2].trim() || isTitleLike(m[2]));
    };
    // When the contract is structured into articles, numbered lines ("1. …") are
    // paragraphs inside them, never headings.
    const articleMode = lines.filter((l) => isArticle(l.trim())).length >= 2;
    const headings = [];
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (!t || t.length > 120)
            continue;
        let found;
        if (/^#{1,6}\s+\S/.test(t)) {
            found = { title: t.replace(/^#+\s*/, ""), bodyLine: i + 1 };
        }
        else if (/^[-*|>]/.test(t)) {
            continue; // Markdown list / table / quote lines are content.
        }
        else {
            const art = ARTICLE_RE.exec(t) ?? PARAGRAPH_SIGN_RE.exec(t);
            if (art) {
                found = numberedHeading(lines, i, t.replace(/[.:\s]+$/, ""), art[2]);
            }
            else if (!articleMode && ROMAN_RE.test(t)) {
                const m = ROMAN_RE.exec(t);
                found = numberedHeading(lines, i, t.replace(/[.:\s]+$/, ""), m[2]);
            }
            else if (!articleMode && NUMBERED_RE.test(t)) {
                const m = NUMBERED_RE.exec(t);
                if (isTitleLike(m[2]))
                    found = { title: m[2].trim(), bodyLine: i + 1 };
            }
            else if (isAllCapsHeading(t)) {
                found = { title: t, bodyLine: i + 1 };
            }
            else if (t.split(/\s+/).length <= 5 && !/[.!?]\s*$/.test(t) && !/\d/.test(t) && KEYWORD_TITLE_RE.test(t)) {
                found = { title: t, bodyLine: i + 1 };
            }
        }
        if (!found)
            continue;
        const raw = found.title.replace(/[:\-—–]+\s*$/, "").trim();
        const norm = normalizeHeading(raw);
        if (!norm)
            continue;
        headings.push({ raw, norm, lineIndex: i, bodyLine: found.bodyLine });
        i = Math.max(i, found.bodyLine - 1);
    }
    return headings;
}
function bestMatch(norm) {
    for (const m of MATCHERS) {
        for (const p of m.patterns) {
            if (p.test(norm))
                return m.key;
        }
    }
    return null;
}
const CATEGORY_KEYS = MATCHERS.map((m) => m.key);
/** True when the text has nothing but blank lines, PDF page markers and Markdown headings. */
export function hasNoContractText(text) {
    return text
        .split(/\n/)
        .map((l) => l.trim())
        .every((l) => !l || PAGE_MARKER_RE.test(l) || /^#{1,6}\s/.test(l) || /^>/.test(l));
}
/**
 * Heuristic segmentation of a Slovak contract into standard clause categories.
 * Every body is a verbatim slice of the input. The `warnings` array states what
 * the heuristic could not establish — a missing category is NOT evidence that
 * the contract lacks such a clause.
 */
export function extractClauses(markdown) {
    const clauses = { ostatne: [], warnings: [] };
    if (!markdown || hasNoContractText(markdown)) {
        clauses.warnings.push("no_text: no contract text to analyse (empty input, or attachments without a text layer). Clauses could not be determined — this does not mean the contract has none.");
        return clauses;
    }
    const lines = markdown.split(/\n/);
    const headings = findHeadings(lines);
    if (headings.length === 0) {
        clauses.warnings.push("no_headings: no recognizable article or section heading was found, so nothing could be categorized. Read the full text (crz_contract_to_markdown).");
    }
    for (let h = 0; h < headings.length; h++) {
        const end = headings[h + 1]?.lineIndex ?? lines.length;
        const body = lines.slice(headings[h].bodyLine, end).join("\n").trim();
        if (!body || hasNoContractText(body))
            continue;
        const key = bestMatch(headings[h].norm);
        if (key) {
            const prev = clauses[key];
            const block = `### ${headings[h].raw}\n\n${body}`;
            clauses[key] = prev ? `${prev}\n\n${block}` : block;
        }
        else {
            clauses.ostatne.push({ heading: headings[h].raw, body });
        }
    }
    const missing = CATEGORY_KEYS.filter((k) => !clauses[k]);
    if (missing.length) {
        clauses.warnings.push(`missing_categories: ${missing.join(", ")} — heuristika pre ne nenašla nadpis článku. Neznamená to, že zmluva také ustanovenie nemá; pred záverom over \`ostatne\` a plný text (crz_contract_to_markdown).`);
        for (const k of missing) {
            const re = INDICATORS[k];
            const m = re ? re.exec(markdown) : null;
            if (m)
                clauses.warnings.push(`possible_${k}: text obsahuje „${m[0]}“ mimo rozpoznaného nadpisu kategórie ${k} — pozri \`ostatne\`.`);
        }
    }
    return clauses;
}
//# sourceMappingURL=clauses.js.map