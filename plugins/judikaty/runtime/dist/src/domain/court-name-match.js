/**
 * Case- and diacritics-insensitive court-name comparison, shared by the
 * justice court-name resolver (exact match against `sud/autocomplete`
 * candidates) and the nsud/ustavny single-court providers (does a requested
 * `courtName` match the one court each of them covers).
 *
 * Deliberately its own tiny module rather than reusing
 * `relation-extractor.ts#normalizeCaseRef`: that function also strips
 * spaces and non-alphanumeric characters, which is right for case
 * references but would collapse "Najvyšší súd Slovenskej republiky" and,
 * say, a hypothetical "Najvyššísúd Slovenskejrepubliky" into the same key --
 * word boundaries matter for names in a way they do not for case refs.
 */
export function normalizeCourtNameForMatch(value) {
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") // strip diacritics
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}
/** True when two court names are the same, ignoring case, diacritics, and whitespace runs. */
export function courtNamesMatch(a, b) {
    return normalizeCourtNameForMatch(a) === normalizeCourtNameForMatch(b);
}
/**
 * Slovak court-type prefixes recognized for instance-level classification,
 * longest/most-specific first ("Najvyšší správny súd" before "Najvyšší
 * súd", so the former is never mis-classified as the latter). Shared by the
 * justice court-name resolver (building same-instance-level suggestions
 * when a `courtName` matches nothing -- see
 * `providers/justice/court-resolver.ts`) and `CourtNameNotFoundError`
 * (deciding whether a suggestion is plausibly a "rename" or just a
 * different grammatical form of the same registry name).
 *
 * "Správny súd" is the administrative-court branch created by the 2021
 * judicial reform (distinct from "Krajský súd" even though both are named
 * after the same city, e.g. "Správny súd v Bratislave" vs "Krajský súd v
 * Bratislave") -- it must classify to its own type, not fall through
 * unclassified, or a broadened place-name lookup would silently let it
 * through as if it were a same-level match for a Krajský súd query.
 */
export const COURT_TYPE_PREFIXES = [
    "Najvyšší správny súd",
    "Najvyšší súd",
    "Špecializovaný trestný súd",
    "Správny súd",
    "Krajský súd",
    "Okresný súd",
    "Mestský súd",
    "Ústavný súd"
];
/**
 * Recognizes a Slovak court-type prefix at the start of `courtName` and
 * splits off the remainder. Case-insensitive on the prefix, diacritics
 * preserved in the returned remainder -- inputs here are expected to
 * already carry correct Slovak diacritics (typically copied from this
 * server's own prior output), so diacritics-folding would only risk
 * stripping too much. Returns `null` when no known prefix matches.
 */
export function classifyCourtType(courtName) {
    const trimmed = courtName.trim();
    const lowerTrimmed = trimmed.toLocaleLowerCase("sk");
    for (const prefix of COURT_TYPE_PREFIXES) {
        const lowerPrefix = prefix.toLocaleLowerCase("sk");
        if (lowerTrimmed === lowerPrefix) {
            return { type: prefix, remainder: "" };
        }
        if (lowerTrimmed.startsWith(`${lowerPrefix} `)) {
            return { type: prefix, remainder: trimmed.slice(prefix.length).trim() };
        }
    }
    return null;
}
/**
 * True when two classified court types may legitimately name the same
 * court. Always true for an exact type match; the one deliberate
 * cross-type exception is Okresný <-> Mestský súd, the genuine 2023
 * court-reorganization rename that folded several Okresné súdy (Bratislava
 * I-IV, Košice I) into unified Mestské súdy. Every other cross-type pairing
 * (e.g. Krajský vs Okresný, Ústavný vs Najvyšší) is refused -- see the
 * module doc comment and `court-resolver.ts` for why suggesting across
 * unrelated instance levels is the bug this exists to prevent.
 */
export function courtTypesAreCompatible(a, b) {
    if (a === b) {
        return true;
    }
    const renamePair = new Set(["Okresný súd", "Mestský súd"]);
    return renamePair.has(a) && renamePair.has(b);
}
//# sourceMappingURL=court-name-match.js.map