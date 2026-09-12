/**
 * Text normalisation shared by the abstract extractor and the full-text indexes.
 */
/**
 * Join letter-spaced words back together.
 *
 * Slovak court documents render emphasis by spacing letters out — "z r u š u j e",
 * "o d m i e t a", "p o t v r d z u j e", "R O Z S U D O K". An FTS5 index tokenizes
 * those as runs of single-character words, so a search for "zrušené" matches none of
 * them: precisely the words that carry a decision's outcome are invisible to search.
 *
 * Only runs of four or more single-letter tokens are joined. Slovak has real
 * one-letter words — a, i, o, s, k, v, u, z — so "o vydanie veci a o náhradu škody"
 * must survive untouched; four in a row is not prose.
 */
/**
 * Every one-letter word in Slovak. A run made up only of these is prose; anything
 * else is letter-spacing, however short.
 */
const REAL_ONE_LETTER_WORDS = new Set(["a", "i", "o", "s", "k", "v", "u", "z", "á", "ó"]);
export function collapseLetterSpacing(value) {
    // Three, not four: PDF extraction often merges the first letters and leaves a short
    // tail — "Ústavnú sťažnosť odmi e t a" was observed in production, where "e t a" is
    // only three tokens. The word guard is what makes the lower threshold safe.
    return value.replace(/(?:(?<![\p{L}])\p{L} ){2,}(?<![\p{L}])\p{L}(?![\p{L}])/gu, (run) => {
        const letters = run.split(" ").filter(Boolean);
        const allRealWords = letters.every((letter) => REAL_ONE_LETTER_WORDS.has(letter.toLowerCase()));
        return allRealWords ? run : run.replace(/ /g, "");
    });
}
/**
 * Text as it should be fed to an FTS index: letter-spacing collapsed, whitespace
 * normalised. The base tables keep the original — citations must reproduce what the
 * court actually published, so only the search index is normalised.
 */
export function normalizeForFts(text) {
    return collapseLetterSpacing(text.replace(/[\t\r ]+/g, " "));
}
//# sourceMappingURL=text-normalization.js.map