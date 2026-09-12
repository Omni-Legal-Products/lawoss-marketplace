/**
 * Relevance ordering and result capping for rpo_search.
 *
 * The register matches names as a diacritics-insensitive substring and returns
 * the whole set in one response, unordered by relevance. Searching "ESET"
 * therefore answered with 134 rows — Rešetár, Reset, Deset, Kešetović — and the
 * exact match sat in eighteenth place. Every name search cost the caller the
 * full set and buried the answer inside it.
 */
/** Fold diacritics and punctuation so "Všeobecná, s.r.o." and "vseobecna sro" compare. */
export function foldName(value) {
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}
/**
 * Slovak legal-form suffixes, already folded by foldName. They are boilerplate,
 * not part of what distinguishes a company: "ESET, spol. s r.o." is named ESET.
 * Without stripping them, a sole trader called "Eset Bjelak" outranks the
 * company on the shorter-name tie-break.
 */
const LEGAL_FORM_SUFFIXES = [
    "spol s r o", "s r o", "sro", "a s", "as", "k s", "v o s", "j s a",
    "n o", "n f", "o z", "s p", "druzstvo", "zdruzenie", "v likvidacii", "v konkurze",
];
/** Drop trailing legal-form boilerplate from an already folded name. */
export function stripLegalForm(folded) {
    let out = folded;
    for (let changed = true; changed;) {
        changed = false;
        for (const suffix of LEGAL_FORM_SUFFIXES) {
            if (out.endsWith(` ${suffix}`)) {
                out = out.slice(0, -(suffix.length + 1)).trim();
                changed = true;
            }
        }
    }
    return out || folded;
}
export const RANK_EXACT = 0;
export const RANK_PREFIX_BOUNDARY = 1;
/**
 * A whole-word hit anywhere outranks a prefix that runs on into another word:
 * for "ESET", "Nadácia ESET" really is that entity, while "ESETA, s.r.o." only
 * happens to start with the same letters.
 */
export const RANK_WORD = 2;
export const RANK_PREFIX = 3;
export const RANK_SUBSTRING = 4;
export const RANK_OTHER = 5;
/**
 * Lower is better.
 *
 * The boundary tier is what separates "ESET, spol. s r.o." from "ESETA, s.r.o.":
 * both start with the query, but only the first ends the query at a word break.
 * Without it the shorter "ESETA" would outrank the exact company.
 */
export function rankName(folded, foldedQuery) {
    if (!foldedQuery)
        return RANK_OTHER;
    if (folded === foldedQuery)
        return RANK_EXACT;
    // "ESET, spol. s r.o." is exactly the company called ESET.
    if (stripLegalForm(folded) === stripLegalForm(foldedQuery))
        return RANK_EXACT;
    const words = folded.split(" ");
    if (folded.startsWith(foldedQuery)) {
        const next = folded.charAt(foldedQuery.length);
        if (next === "" || next === " ")
            return RANK_PREFIX_BOUNDARY;
        return words.includes(foldedQuery) ? RANK_WORD : RANK_PREFIX;
    }
    if (words.includes(foldedQuery))
        return RANK_WORD;
    if (folded.includes(foldedQuery))
        return RANK_SUBSTRING;
    return RANK_OTHER;
}
/**
 * Order by relevance to the caller's query. Ties break on the shorter name
 * (a closer match) and then alphabetically, so the order is deterministic and
 * a caller taking the first row twice gets the same row.
 */
export function rankResults(rows, query) {
    const foldedQuery = foldName(query.fullName ?? "");
    const ico = (query.identifier ?? "").replace(/\D/g, "");
    return [...rows]
        .map((row, index) => {
        const folded = foldName(row.name ?? "");
        // An exact IČO hit is the answer regardless of what the name looks like.
        const rank = ico && (row.ico ?? "").replace(/\D/g, "") === ico
            ? RANK_EXACT
            : rankName(folded, foldedQuery);
        return { row, index, rank, folded };
    })
        .sort((a, b) => a.rank - b.rank ||
        a.folded.length - b.folded.length ||
        a.folded.localeCompare(b.folded) ||
        a.index - b.index)
        .map((entry) => entry.row);
}
/** Slovenčina rozlišuje 1 / 2-4 / 5+: "1 zhodu", "3 zhody", "134 zhôd". */
export function plural(n, one, few, many) {
    const form = n === 1 ? one : n >= 2 && n <= 4 ? few : many;
    return `${n} ${form}`;
}
/**
 * Celá väzba naraz, nie len číslovka.
 *
 * Slovenská číslovka od 5 vyžaduje genitív, takže sa mení aj sloveso aj
 * prídavné meno: "vrátených je prvých 20" vs "vrátené sú prvé 3". Skloňovať
 * len číslo dá nezmysel typu "vrátených je prvé 3", preto sa tvarom riadi
 * celá fráza.
 */
export function vraciam(n) {
    return `vraciam ${plural(n, "najpresnejšiu", "najpresnejšie", "najpresnejších")}`;
}
export const DEFAULT_SEARCH_LIMIT = 20;
/**
 * Cap the response, but never silently: `count` stays the full number of
 * matches and `truncated` says the list is partial, so a caller cannot read a
 * capped list as the complete answer.
 */
export function capResults(rows, query, limit = DEFAULT_SEARCH_LIMIT) {
    const effective = Math.max(1, limit);
    const ranked = rankResults(rows, query);
    const results = ranked.slice(0, effective);
    const truncated = ranked.length > results.length;
    return {
        count: ranked.length,
        returned: results.length,
        truncated,
        limit: effective,
        results,
        ...(truncated
            ? {
                note: `Register našiel ${plural(ranked.length, "zhodu", "zhody", "zhôd")}; ` +
                    `${vraciam(results.length)} podľa presnosti zhody s menom. ` +
                    "Zvýš limit, alebo dopyt zúž (onlyActive, addressMunicipality, sourceRegister, legalForm).",
            }
            : {}),
    };
}
