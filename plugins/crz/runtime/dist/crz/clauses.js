// Slovak headings are matched case-insensitively, ignoring diacritics & punctuation.
// Each pattern is tried against a "normalized" form of the heading.
const MATCHERS = [
    { key: "predmet", patterns: [/\bpredmet(\s+(zmluvy|dohody|kupy))?\b/, /\buvodne ustanovenia\b/] },
    { key: "cena", patterns: [/\b(cena|kupna cena|odmena|cena diela|cena za dielo)\b/] },
    { key: "platobne_podmienky", patterns: [/\bplatobne podmienky\b/, /\bfakturacia\b/, /\bsposob platby\b/] },
    { key: "sankcie", patterns: [/\bsankcie\b/, /\bzmluvne pokuty\b/, /\buroky z omeskania\b/] },
    { key: "doba_a_ukoncenie", patterns: [/\bdoba (trvania|platnosti)\b/, /\bukoncenie zmluvy\b/, /\bskoncenie zmluvy\b/, /\bvypoved\b/, /\bodstupenie\b/] },
    { key: "rozhodne_pravo", patterns: [/\brozhodne pravo\b/, /\briesenie sporov\b/, /\baplikovatelne pravo\b/] },
    { key: "zaverecne_ustanovenia", patterns: [/\bzaverecne ustanovenia\b/, /\bvseobecne ustanovenia\b/, /\bspolocne ustanovenia\b/] },
    { key: "prilohy", patterns: [/\bprilohy\b/, /\bzoznam priloh\b/] },
];
// Roman/numbering prefix at the head of a stripped heading. Must require trailing
// boundary (period or whitespace) so we don't eat the leading letter of an actual
// word like "Cena" being mis-matched as Roman "C".
const ROMAN_OR_NUM_PREFIX = /^(?:Cl(?:anok|ánok)\s+|Cast\s+|[IVXLCDM]{1,5}(?:\.\s*|\s+)|\d{1,3}[.)]\s+|§\s*\d+\.?\s*)/;
function normalizeHeading(s) {
    return s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function isHeadingLine(line) {
    const t = line.trim();
    if (!t)
        return false;
    if (t.length > 120)
        return false;
    // Patterns we accept as headings:
    //   "Článok I — Predmet zmluvy"
    //   "Článok 1. Cena"
    //   "I. PREDMET ZMLUVY"
    //   "§ 5. Sankcie"
    //   "1. Predmet"
    //   Or any Markdown ATX heading
    if (/^#{1,6}\s+\S/.test(t))
        return true;
    if (/^(článok|clanok|čl\.|cl\.|časť|cast|§)\b/i.test(t))
        return true;
    // Require a period or right paren after Roman numerals to avoid matching prose
    // sentences that happen to start with "V " (a common Slovak preposition).
    if (/^[IVXLCDM]{1,5}[.)]\s+\S/.test(t))
        return true;
    if (/^\d{1,3}\.\s+\S/.test(t) && /[A-ZÁ-Žá-ž]/.test(t))
        return true;
    if (t === t.toUpperCase() && t.length > 3 && /[A-ZÁ-Ž]/.test(t) && /[A-ZÁ-Ž\s]/.test(t))
        return true;
    // Fallback: short standalone titles using well-known Slovak section words.
    // Must look like a heading (few words, no digits, no terminal sentence punctuation)
    // to avoid matching body sentences that happen to start with the same word.
    const wordCount = t.split(/\s+/).length;
    if (wordCount <= 5 &&
        !/[.!?]\s*$/.test(t) &&
        !/\d/.test(t) &&
        /^(predmet|cena|odmena|platobn[éeê]\s+podmienky|sankcie|zmluvn[ée]\s+pokut|doba|ukon[čc]enie|skon[čc]enie|rozhodn[ée]\s+pr[áa]vo|z[áa]vere[čc]n[ée]|spolo[čc]n[ée]|prilohy|pr[íi]lohy|zoznam\s+pr[íi]loh)\b/i.test(t))
        return true;
    return false;
}
function stripPrefix(line) {
    // Strip "Článok ", "Cast ", roman numerals, "§ N", trailing colon.
    let s = line.replace(/^#+\s*/, "");
    s = s.replace(/^(článok|clanok|čl\.|cl\.|časť|cast)\s+[^\s—–:-]+\s*[—–:\-.]?\s*/i, "");
    s = s.replace(ROMAN_OR_NUM_PREFIX, "");
    s = s.replace(/[:\.\-—–]+\s*$/, "");
    return s.trim();
}
function findHeadings(text) {
    const headings = [];
    const lines = text.split(/\n/);
    let offset = 0;
    for (const line of lines) {
        const lineLen = line.length + 1;
        if (isHeadingLine(line)) {
            const cleaned = stripPrefix(line);
            const norm = normalizeHeading(cleaned);
            if (norm)
                headings.push({ raw: cleaned, norm, lineStart: offset, start: offset + lineLen });
        }
        offset += lineLen;
    }
    for (let i = 0; i < headings.length; i++) {
        headings[i].rangeEnd = headings[i + 1]?.lineStart ?? text.length;
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
export function extractClauses(markdown) {
    const clauses = { ostatne: [] };
    if (!markdown || !markdown.trim())
        return clauses;
    const headings = findHeadings(markdown);
    if (headings.length === 0)
        return clauses;
    for (const h of headings) {
        const body = markdown.slice(h.start, h.rangeEnd ?? markdown.length).trim();
        if (!body)
            continue;
        const key = bestMatch(h.norm);
        if (key) {
            const prev = clauses[key];
            const block = `### ${h.raw}\n\n${body}`;
            clauses[key] = prev ? `${prev}\n\n${block}` : block;
        }
        else {
            clauses.ostatne.push({ heading: h.raw, body });
        }
    }
    return clauses;
}
//# sourceMappingURL=clauses.js.map