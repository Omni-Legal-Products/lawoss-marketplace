/**
 * Deterministic abstract of a decision: what the court decided, and how the
 * reasoning opens.
 *
 * Search relevance currently rests on bm25 over the full judgment, which is a weak
 * signal for legal work — a twenty-page text matches almost any query about its
 * subject area, and returning it costs 4-6k tokens per hit. The operative part
 * (výrok) plus the opening of the reasoning is where the holding actually lives,
 * so indexing that separately is both a better ranking signal and ~200 tokens per
 * hit instead of thousands.
 *
 * No model is involved. Slovak judgments are structured: the operative part sits
 * between "rozhodol takto:" and "Odôvodnenie". A future LLM-written právna veta
 * has a reserved place alongside this (`holding`), which is why the extraction
 * result carries its `source`.
 */
import { collapseLetterSpacing } from "./text-normalization.js";
const VYROK_CAP = 1500;
const LEAD_CAP = 800;
/**
 * Matched against despaced, diacritics-folded text, so "r o z h o d o l  t a k t o :"
 * and "rozhodol takto:" are the same needle.
 *
 * Measured 2026-08-03: looking only for "rozhodol takto" found the operative part in
 * 11 of 399 NS decisions (2.8%). Courts also write "takto rozhodol", a bare
 * "r o z h o d o l :", and several other openings. So the search is structural
 * instead: the operative part is the text between the LAST verb of this family and
 * the reasoning heading, because the operative part always immediately precedes the
 * reasoning.
 */
const VYROK_OPENING_NEEDLES = [
    "rozhodoltakto",
    "taktorozhodol",
    "rozhodlatakto",
    "taktorozhodla",
    "rozhodlitakto",
    "taktorozhodli",
    "rozhodolnasledovne",
    "vyhlasiltentorozsudok",
    "vydaltentorozsudok"
];
/**
 * Fallback only. A bare "rozhodol" also occurs *inside* operative parts, which
 * frequently quote the decision under review ("...uznesenie, ktorým rozhodol o..."),
 * so using it when a proper opening exists cuts the operative part in half. Measured
 * effect of getting this wrong: the ÚS median operative part collapsed to 59
 * characters.
 */
const VYROK_BARE_VERB_NEEDLES = ["rozhodol", "rozhodla", "rozhodli"];
const REASONING_NEEDLES = ["odovodnenie"];
/**
 * Despaced, diacritics-folded copy of `text`, plus a map from each folded
 * character back to its index in the original — needed because the marker is
 * found in folded space but the section must be cut from the original.
 */
function foldWithOffsets(text) {
    const folded = [];
    const offsets = [];
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (/\s/.test(char))
            continue;
        const stripped = char.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
        // A single source character can fold to several (or zero) characters.
        for (const piece of stripped) {
            folded.push(piece);
            offsets.push(index);
        }
    }
    return { folded: folded.join(""), offsets };
}
function findFirst(folded, needles) {
    let best = -1;
    for (const needle of needles) {
        const index = folded.indexOf(needle);
        if (index >= 0 && (best === -1 || index < best))
            best = index;
    }
    return best;
}
/**
 * The operative part is introduced by the last "rozhodol"-family verb before the
 * reasoning heading. Earlier occurrences belong to the recitals, where the judgment
 * describes what the lower courts decided.
 */
function findVyrokVerb(folded, before) {
    // Prefer an explicit opening; fall back to a bare verb only when there is none,
    // so a quoted "rozhodol" inside the operative part cannot truncate it.
    return (findLatest(folded, VYROK_OPENING_NEEDLES, before) ??
        findLatest(folded, VYROK_BARE_VERB_NEEDLES, before));
}
function findLatest(folded, needles, before) {
    let best = null;
    for (const needle of needles) {
        let from = 0;
        for (;;) {
            const index = folded.indexOf(needle, from);
            if (index < 0 || (before >= 0 && index >= before))
                break;
            // Prefer the latest position; on a tie prefer the longer, more specific needle.
            if (!best || index > best.index || (index === best.index && needle.length > best.length)) {
                best = { index, length: needle.length };
            }
            from = index + 1;
        }
    }
    return best;
}
/**
 * Is this occurrence of "odôvodnenie" a section heading rather than the word used
 * in a sentence?
 *
 * Real failure it prevents: a zmenkový platobný rozkaz has no reasoning section, but
 * its Poučenie contains "námietky, ktoré neobsahujú odôvodnenie, alebo…", and
 * treating that as the heading cut the operative part in half.
 *
 * "Follows a sentence end" alone is too strict. Operative parts often end without a
 * full stop and PDF extraction glues the heading to the last word, so on 2026-09-20
 * about 7 % of live search hits had the whole reasoning inside the operative part:
 * "…trov konania odôvodnenie: Návrhom…", "…neodnímaOdôvodnenie : Žalobca…",
 * "Dovolanie odmieta\nOdôvodnenie\nOkresný súd…". A heading is therefore any
 * occurrence that follows a non-lowercase character, OR is capitalised itself, OR
 * is directly followed by a colon. The word inside a clause is lowercase, follows
 * a lowercase letter and is followed by a comma, a bracket or more text.
 */
function isSectionHeading(text, startIndex, endIndex) {
    if (/\p{Lu}/u.test(text[startIndex] ?? ""))
        return true;
    if (/^\s*:/u.test(text.slice(endIndex, endIndex + 4)))
        return true;
    for (let index = startIndex - 1; index >= 0; index -= 1) {
        const char = text[index];
        if (/\s/.test(char))
            continue;
        return !/\p{Ll}/u.test(char);
    }
    return true; // start of document
}
/**
 * PDF extraction leaves running headers behind: a page number, often followed by the
 * case references repeated at the top of each page. They cluster at the start of a
 * section, which is where they are stripped. Occurrences in the middle of a section
 * are left alone — removing those safely would need layout information the extracted
 * text no longer carries.
 */
function stripLeadingNoise(value) {
    let out = value;
    for (;;) {
        const before = out;
        out = out
            .replace(/^[\s:.,;–-]+/u, "")
            // A bare page number, but never "1." — paragraph numbering is content.
            .replace(/^\d{1,4}(?!\s*\.)(?=\s)/u, "")
            .replace(/^\d{1,3}\s?[A-Za-zÁ-Žá-ž]{1,6}\s?\/?\s?\d{1,5}\/\d{4}[\s,;]*/u, "")
            .replace(/^[IVX]{1,4}\.?\s?[ÚU]S\s?\d{1,4}\/\d{4}[\s,;]*/u, "");
        if (out === before)
            return out;
    }
}
function tidy(section, cap) {
    const collapsed = collapseLetterSpacing(section.replace(/\s+/g, " "));
    const trimmed = stripLeadingNoise(collapsed).trim();
    if (trimmed.length === 0)
        return null;
    if (trimmed.length <= cap)
        return trimmed;
    // Cut on a sentence boundary where possible so the text stays readable.
    const clipped = trimmed.slice(0, cap);
    const lastStop = clipped.lastIndexOf(". ");
    return lastStop > cap * 0.5 ? clipped.slice(0, lastStop + 1) : clipped;
}
/**
 * Where the operative part and the reasoning sit. Shared by the abstract and by
 * `findOperativePartBounds`, so both always agree on what the operative part is.
 */
function locateSections(text) {
    const { folded, offsets } = foldWithOffsets(text);
    if (folded.length === 0)
        return null;
    // Only an occurrence that behaves like a heading counts; the word also appears in
    // ordinary sentences, and believing those splits the operative part apart.
    let reasoningMarker = -1;
    for (const needle of REASONING_NEEDLES) {
        let from = 0;
        for (;;) {
            const index = folded.indexOf(needle, from);
            if (index < 0)
                break;
            const original = offsets[index];
            const originalEnd = (offsets[index + needle.length - 1] ?? text.length - 1) + 1;
            if (original !== undefined && isSectionHeading(text, original, originalEnd)) {
                if (reasoningMarker === -1 || index < reasoningMarker)
                    reasoningMarker = index;
                break;
            }
            from = index + 1;
        }
    }
    const verb = findVyrokVerb(folded, reasoningMarker);
    let operative = null;
    if (verb) {
        const start = offsets[verb.index + verb.length] ?? text.length;
        const end = reasoningMarker >= 0 ? (offsets[reasoningMarker] ?? text.length) : text.length;
        operative = { start, end };
    }
    return { folded, offsets, reasoningMarker, operative };
}
/**
 * The operative part's [start, end) offsets in `text` (raw, untidied), found by the
 * same logic as `buildDecisionAbstract`: between the last výrok-opening verb and the
 * reasoning heading. Null when there is no opening verb or the span is empty.
 */
export function findOperativePartBounds(text) {
    if (!text || text.trim().length === 0)
        return null;
    const sections = locateSections(text);
    const operative = sections?.operative;
    if (!operative || operative.end <= operative.start)
        return null;
    return { ...operative, endsAtReasoning: sections.reasoningMarker >= 0 };
}
export function buildDecisionAbstract(text) {
    if (!text || text.trim().length === 0)
        return null;
    const sections = locateSections(text);
    if (!sections)
        return null;
    const { folded, offsets, reasoningMarker, operative } = sections;
    let vyrok = null;
    if (operative && operative.end > operative.start) {
        vyrok = tidy(text.slice(operative.start, operative.end), VYROK_CAP);
    }
    let lead = null;
    if (reasoningMarker >= 0) {
        const needleLength = REASONING_NEEDLES.find((needle) => folded.startsWith(needle, reasoningMarker))?.length ?? 0;
        const start = offsets[reasoningMarker + needleLength] ?? text.length;
        lead = tidy(text.slice(start, start + LEAD_CAP * 3), LEAD_CAP);
    }
    if (!vyrok && !lead)
        return null;
    return { vyrok, lead, holding: null, source: "deterministic" };
}
//# sourceMappingURL=decision-abstract.js.map