// src/domain/relation-extractor.ts
import { findOperativePartBounds } from "./decision-abstract.js";
/**
 * Canonical key for matching Slovak case references regardless of spacing,
 * separators (slash vs space), dots, or diacritics.
 * "5 Co 55/2009" and "5Co/55/2009" both → "5CO552009".
 */
export function normalizeCaseRef(raw) {
    return raw
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") // strip diacritics
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, ""); // keep only letters + digits
}
// Ordinary registrová značka: "1Cdo/85/2023", "5 Co 55/2009", "75Ek/2098/2020".
const CASE_REF_RE = /\b(\d{1,3}\s?[A-Za-zÁ-Žá-ž]{1,6}\s?\/?\s?\d{1,5}\/\d{4})\b/gu;
// Constitutional senate ref: "III. ÚS 550/2024", "I. US 200/2025".
const US_REF_RE = /\b([IVX]{1,4}\.?\s?[ÚU]S\s?\d{1,4}\/\d{4})\b/gu;
/**
 * Every ordinary and constitutional reference in `text`, ordinary ones first, in match
 * order within each kind (unsorted across kinds). Exposed for the model-label evidence
 * pack, which must reproduce system1-legal-bench refs.mjs byte for byte — that file
 * copied these two patterns from here.
 */
export function scanCaseRefs(text) {
    const out = [];
    for (const re of [CASE_REF_RE, US_REF_RE]) {
        for (const m of text.matchAll(re)) {
            if (m.index !== undefined)
                out.push({ raw: m[1] ?? m[0], index: m.index });
        }
    }
    return out;
}
// Anchored counterparts: the value must BE a reference, not merely contain one.
const WHOLE_CASE_REF_RE = /^\d{1,3}\s?[A-Za-zÁ-Žá-ž]{1,6}\s?\/?\s?\d{1,5}\/\d{4}$/u;
// The ÚS also files plenary cases ("PL. ÚS 3/09") and used two-digit years before 2010
// ("I. ÚS 199/05"); both are real values of the DMS field mkRSAPNumberOfFile.
const WHOLE_US_REF_RE = /^(?:[IVX]{1,4}|P[Ll])\.?\s?[ÚU]S\s?\d{1,4}\/(?:\d{4}|\d{2})$/u;
/**
 * Does this value look like a spisová značka?
 *
 * The NS API's `cislo` field sometimes carries the subject of the proceedings
 * ("odvolanie obžalovaného", "16 376,62 eur s prísl.") instead of the reference,
 * and that value flows into search results and into the relation index as the
 * reviewing decision's ref — where it renders as "zrušené ← odvolanie obžalovaného",
 * which tells a lawyer nothing. Callers use this to present such values as unknown
 * instead. Validation happens on read: the raw value stays in the database, so
 * nothing is lost and no backfill over 160k records is needed.
 */
export function looksLikeCaseRef(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        return false;
    return WHOLE_CASE_REF_RE.test(trimmed) || WHOLE_US_REF_RE.test(trimmed);
}
/** The value when it is a usable case reference, otherwise null. */
export function asCaseRef(value) {
    const trimmed = value?.trim();
    return trimmed && looksLikeCaseRef(trimmed) ? trimmed : null;
}
/**
 * How far into the text a reference may sit and still count as the header's own.
 * Measured on 300 production records: real own-references appeared at offsets 0-136,
 * while references belonging to other cases show up later, in the prose.
 */
const HEADER_REF_MAX_OFFSET = 150;
/**
 * Recover a decision's own spisová značka from the opening lines of its text.
 *
 * 41.6% of NS records (67,014 of 160,950) have no usable reference and no ECLI, and
 * the NS API has none either — 20 of 20 sampled came back with subject-matter text
 * instead. Without a reference these decisions cannot be matched against the
 * relation index at all, so "was this overturned?" is unanswerable for them.
 *
 * A judgment does state its own file number, next to the court's name, in its first
 * lines. Measured over 300 of those records: 62% of headers carry exactly one
 * reference, 35% carry two — and in every ambiguous case inspected, the first is the
 * deciding court's own and the second is the file number of the case it reviews.
 * So the first match wins, and only when it appears early enough to be part of the
 * header rather than the reasoning.
 *
 * Callers must present the result as derived, not as portal metadata.
 */
export function deriveCaseRefFromHeader(text) {
    const head = text?.slice(0, 600);
    if (!head || head.trim().length === 0)
        return null;
    const matches = [];
    for (const match of head.matchAll(CASE_REF_RE)) {
        if (match[1] && match.index !== undefined)
            matches.push({ ref: match[1].trim(), index: match.index });
    }
    for (const match of head.matchAll(US_REF_RE)) {
        if (match[1] && match.index !== undefined)
            matches.push({ ref: match[1].trim(), index: match.index });
    }
    if (matches.length === 0)
        return null;
    matches.sort((a, b) => a.index - b.index);
    const first = matches[0];
    if (first.index > HEADER_REF_MAX_OFFSET)
        return null;
    const distinct = new Set(matches.map((m) => m.ref));
    return { ref: first.ref, ambiguous: distinct.size > 1 };
}
// A leading court code on justice portal references: "SI-5Er/745/2012", "K3-6T/206/2012".
const COURT_PREFIX_RE = /^\s*[A-Za-z0-9]{1,4}\s*-\s*/u;
/**
 * The reference without its leading court code, or null when there is none.
 *
 * The justice portal stores a decision's own number as "K3-6T/206/2012", while the
 * decision's text and its `povodnaSpisovaZnacka` say "6T/206/2012". Only a remainder
 * that is itself a whole reference counts, so "II. ÚS 104/2026-38" is left alone.
 */
export function stripCourtPrefix(ref) {
    const trimmed = ref?.trim();
    if (!trimmed)
        return null;
    const match = COURT_PREFIX_RE.exec(trimmed);
    if (!match)
        return null;
    return asCaseRef(trimmed.slice(match[0].length));
}
/**
 * Every normalised form under which a decision may refer to its own file number.
 *
 * Measured on the production index 2026-09-23: 443,622 of 565,318 justice relations
 * pointed at the source's own number, because the stored reference carried a court
 * prefix the text did not. 3,199 of them carried an outcome and surfaced as
 * "S reviewed S".
 *
 * The header-derived reference is consulted only when the stored one is not a usable
 * reference (the NS records whose `cislo` holds subject-matter text). A usable stored
 * reference is authoritative, and many texts open with the REVIEWED decision's number
 * ("proti uzneseniu Najvyššieho súdu … 1Cdo/85/2023 …"), which the header heuristic
 * would otherwise mistake for the source's own. Whether the header is ambiguous does
 * not matter: its first reference is the deciding court's own (see
 * `deriveCaseRefFromHeader`), and later ones are never added. That study covered NS
 * texts only, so callers pass `text` for NS sources and null elsewhere.
 */
export function ownRefNorms(sourceRef, text) {
    const own = new Set();
    const stored = sourceRef?.trim() ?? "";
    if (stored) {
        const norm = normalizeCaseRef(stored);
        if (norm)
            own.add(norm);
    }
    const bare = stripCourtPrefix(stored);
    if (bare)
        own.add(normalizeCaseRef(bare));
    if (!bare && !looksLikeCaseRef(stored)) {
        const derived = deriveCaseRefFromHeader(text);
        if (derived)
            own.add(normalizeCaseRef(derived.ref));
    }
    return own;
}
/**
 * Is this stored relation a decision pointing at its own file number?
 *
 * Read-time counterpart of the extractor's self check, for rows already in the
 * database. It sees only the stored reference, not the text, so NS rows whose own
 * number is known only from the header cannot be recognised here.
 */
export function isSelfRelation(sourceRef, targetRefNorm) {
    return ownRefNorms(sourceRef, null).has(targetRefNorm);
}
const COURT_KEYWORDS = [
    { needle: "najvyssiehosudu", name: "Najvyšší súd SR" },
    { needle: "najvyssisud", name: "Najvyšší súd SR" },
    { needle: "ustavnehosudu", name: "Ústavný súd SR" },
    { needle: "ustavnysud", name: "Ústavný súd SR" },
    { needle: "krajskehosudu", name: "Krajský súd" },
    { needle: "krajskysud", name: "Krajský súd" },
    { needle: "okresnehosudu", name: "Okresný súd" },
    { needle: "okresnysud", name: "Okresný súd" },
    { needle: "mestskehosudu", name: "Mestský súd" },
    { needle: "mestskysud", name: "Mestský súd" }
];
function despace(value) {
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, "");
}
/**
 * Lowercase, diacritics-free copy with exactly one output character per input UTF-16
 * unit, so an index into the copy is an index into the original.
 */
function foldSameLength(value) {
    let out = "";
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        out += char.normalize("NFD")[0]?.toLowerCase()[0] ?? char;
    }
    return out;
}
/**
 * A court of another state, or an international court, named right before a
 * reference. Real failure it prevents: "rozhodnutie Najvyššieho súdu Českej republiky
 * sp. zn. 22 Cdo 1715/2010", cited by a party, was stored as a Slovak Supreme Court
 * decision this judgment had confirmed. Matched on whole words of folded text; a
 * despaced "cr" would hit inside ordinary words.
 */
const FOREIGN_COURT_RE = /\b(?:ceskej republiky|ceske republiky|cr|csr|cssr|csfr|(?:nejvyss|ustavn|vrchn|krajsk|okresn|mestsk)\w* soud\w*|eslp|sdeu|sd eu|esd|sudn\w* dvor\w*|europsk\w* sud\w* pre ludske prava|europsk\w* komisi\w* pre ludske prava)\b/gu;
/**
 * A Slovak court named after the foreign marker takes precedence ("…ESĽP… rozsudok NS SR
 * sp. zn."). In "Najvyššieho súdu Českej republiky" the marker comes last, so it wins.
 */
const SLOVAK_COURT_RE = /\b(?:najvyss|ustavn|krajsk|okresn|mestsk|specializovan)\w* sud\w*/gu;
function lastMatchIndex(re, value) {
    let last = -1;
    for (const match of value.matchAll(re))
        last = match.index ?? last;
    return last;
}
function isForeignContext(before) {
    const folded = foldSameLength(before).replace(/\s+/g, " ");
    const foreign = lastMatchIndex(FOREIGN_COURT_RE, folded);
    return foreign >= 0 && foreign > lastMatchIndex(SLOVAK_COURT_RE, folded);
}
function detectCourt(before) {
    // "Najvyššieho súdu Českej republiky" contains the Slovak keyword but is not NS SR.
    if (isForeignContext(before))
        return null;
    const b = despace(before);
    let best = null;
    for (const { needle, name } of COURT_KEYWORDS) {
        const idx = b.lastIndexOf(needle);
        if (idx >= 0 && (best === null || idx > best.index)) {
            best = { name, index: idx };
        }
    }
    return best?.name ?? null;
}
const OPERATIVE_VERBS = new Set([
    "zrusuje",
    "meni",
    "potvrdzuje",
    "odmieta",
    "zamieta",
    "vracia",
    "zastavuje",
    "nevyhovuje"
]);
/**
 * Violation findings. Unlike the other verbs the perfect "porušil" is operative here:
 * it is how the Constitutional Court words its own finding in the výrok, and only the
 * výrok is searched. The participle needs the auxiliary that follows it.
 */
const VIOLATION_PARTICIPLES = new Set(["porusene", "poruseny", "porusena", "poruseni"]);
const VIOLATION_PERFECTS = new Set(["porusil", "porusili", "porusila", "porusilo"]);
const NEGATED_VIOLATION_PERFECTS = new Set(["neporusil", "neporusili", "neporusila", "neporusilo"]);
const AUXILIARY = new Set(["bolo", "boli", "bol", "bola"]);
const NEGATED_AUXILIARY = new Set(["nebolo", "neboli", "nebol", "nebola"]);
const MAX_VERB_LENGTH = 10;
/** Every one-letter word in Slovak (see text-normalization.ts). */
const ONE_LETTER_WORDS = new Set(["a", "i", "o", "s", "k", "v", "u", "z"]);
/**
 * The operative verbs in `segment`, matched as whole words.
 *
 * Whole words are what keeps "nezrušuje", "nemení" and "zmení" out. PDF extraction
 * splits words in two ways that a plain word match misses, so a verb may also be a
 * run of adjacent tokens separated only by whitespace:
 * - letter-spacing, "p o t v r d z u j e s tým" — where collapsing the run would glue
 *   the following "s" on and lose the verb;
 * - fragments, "zru šu je a v ec vraci a" (observed in ÚS texts).
 * A verb may not start in the middle of a letter-spaced run, so "n e z r u š u j e"
 * does not yield "zrušuje"; one glued one-letter word before it ("a z r u š u j e")
 * is allowed.
 */
function operativeVerbs(segment) {
    const folded = foldSameLength(segment);
    const tokens = [];
    let lastEnd = -1;
    for (const match of folded.matchAll(/\p{L}+/gu)) {
        const index = match.index ?? 0;
        const joinable = lastEnd >= 0 && /^\s+$/u.test(folded.slice(lastEnd, index));
        tokens.push({ text: match[0], joinable });
        lastEnd = index + match[0].length;
    }
    const isSpacedLetter = (i) => tokens[i]?.text.length === 1;
    const startsMidRun = (i) => {
        if (!tokens[i].joinable || !isSpacedLetter(i) || !isSpacedLetter(i - 1))
            return false;
        // One real one-letter word glued in front is fine; anything longer is a prefix.
        const glued = tokens[i - 1];
        return !ONE_LETTER_WORDS.has(glued.text) || (glued.joinable && isSpacedLetter(i - 2));
    };
    const found = new Set();
    for (let i = 0; i < tokens.length; i += 1) {
        if (startsMidRun(i))
            continue;
        let joined = "";
        for (let j = i; j < tokens.length; j += 1) {
            if (j > i && !tokens[j].joinable)
                break;
            joined += tokens[j].text;
            if (joined.length > MAX_VERB_LENGTH)
                break;
            if (OPERATIVE_VERBS.has(joined))
                found.add(joined);
            // Older NS judgments write "zmeňuje" for "mení".
            if (joined === "zmenuje")
                found.add("meni");
            if (VIOLATION_PERFECTS.has(joined))
                found.add("porusene");
            if (NEGATED_VIOLATION_PERFECTS.has(joined))
                found.add("neporusene");
            if (VIOLATION_PARTICIPLES.has(joined)) {
                const next = tokens[j + 1]?.text;
                if (next && AUXILIARY.has(next))
                    found.add("porusene");
                if (next && NEGATED_AUXILIARY.has(next))
                    found.add("neporusene");
            }
        }
    }
    return found;
}
function dispositionFromVerbs(verbs) {
    const quashes = verbs.has("zrusuje");
    const changes = verbs.has("meni");
    const confirms = verbs.has("potvrdzuje");
    // "vo výrokoch I. až V. potvrdzuje … vo výroku VI. mení" is neither outcome alone.
    if (confirms && (changes || quashes))
        return "ciastocne";
    if (quashes)
        return verbs.has("vracia") ? "zrusene_vratene" : "zrusene";
    if (changes)
        return "zmenene";
    if (confirms)
        return "potvrdene";
    // Only now are "odmieta"/"zamieta" about the remedy; next to the verbs above they
    // dispose of motions (a návrh, a request for costs), not of the decision.
    // A violation without a quashing order: the decision itself stands.
    if (verbs.has("porusene"))
        return "porusenie_prava";
    if (verbs.has("odmieta"))
        return "odmietnute";
    // "sťažnosti nevyhovuje", "porušené neboli": the remedy failed on the merits.
    if (verbs.has("zamieta") || verbs.has("nevyhovuje") || verbs.has("neporusene"))
        return "zamietnute";
    if (verbs.has("zastavuje"))
        return "zastavene";
    return "ine";
}
/** Outcomes under which the challenged decision stands whatever else the výrok says. */
const STANDING_OUTCOMES = new Set([
    "potvrdene",
    "odmietnute",
    "zamietnute",
    "zastavene",
    "porusenie_prava"
]);
/**
 * Where the statement that starts before `from` ends: the next sentence end
 * (a full stop or semicolon followed by a capital or a numbered item), or `limit`.
 * Full stops of abbreviations and initials ("sp. zn.", "č. k.", "JUDr.", "J. K.")
 * do not end a statement.
 */
const NOT_A_SENTENCE_END_RE = /(?:^|[\s(])(?:\p{Lu}|judr|mgr|ing|phdr|dr|doc|prof|bc|phd|c|sp|zn|ods|pism|zb|z|s|r|o|tzv|napr|resp|atd|sb|v)$/u;
function statementEnd(text, from, limit) {
    const re = /[.;]\s+(?=\p{Lu}|[IVX]+\.\s)/gu;
    re.lastIndex = from;
    for (let m = re.exec(text); m !== null && m.index < limit; m = re.exec(text)) {
        const before = foldSameLength(text.slice(Math.max(from, m.index - 8), m.index));
        if (text[m.index] === "." && NOT_A_SENTENCE_END_RE.test(before))
            continue;
        return m.index;
    }
    return limit;
}
/** "na odvolanie … proti rozsudku Okresného súdu … č. k. 5C/1/2019" — the challenged decision. */
const CHALLENGED_DECISION_RE = /\bproti (?:\p{L}+ ){0,2}(?:rozsudku|uzneseniu|rozhodnutiu|rozkazu|vyroku|vyrokom|nalezu|rozsudkom|uzneseniam|rozhodnutiam)\b/u;
/**
 * Constitutional Court preambles name the challenged acts differently: "vo veci
 * namietaného porušenia … postupom a uznesením Krajského súdu … sp. zn. X". Only used
 * once the preamble carries "namietaného porušenia".
 */
const US_COMPLAINT_RE = /\bnamietan\p{L}* porusen/u;
const US_CHALLENGED_ACT_RE = /\b(?:postupom|rozsudkom|uznesenim|rozhodnutim|nalezom|rozkazom|vyrokom|konanim|konani)\b/u;
/**
 * Text between two listed challenged decisions ("č. k. 13Co/858/2015-90 a č. k.
 * 13Co/860/2015-99"): a relative clause, a past-tense description or a file location
 * means the next reference is something else.
 */
const LIST_BREAK_RE = /ktor|veden|potvrdil|zrusil|zmenil|rozhodol|zamietol|odmietol|takto/u;
const LIST_GAP_MAX = 200;
const CHALLENGED_DECISION_WINDOW = 200;
const FOREIGN_CONTEXT_WINDOW = 200;
/**
 * Without a reasoning heading the operative part would run to the end of the text,
 * reasoning included. Measured operative parts rarely exceed the abstract's cap, so
 * evidence is not looked for beyond this.
 */
const UNBOUNDED_OPERATIVE_CAP = 3000;
const CONFIDENCE = {
    /** The reference sits in the operative part, followed by its own verbs. */
    operative: { withCourt: 0.9, withoutCourt: 0.6 },
    /** The preamble names the challenged decision; the operative part names none. */
    preamble: { withCourt: 0.7, withoutCourt: 0.5 },
    mention: 0.3
};
/**
 * Relations from one judgment's text to the decisions it references.
 *
 * Every reference becomes a relation, but an outcome is claimed only with evidence
 * from this decision's own operative part (výrok):
 * (a) the reference sits inside the operative part and present-tense operative verbs
 *     follow it in its statement (see `verbsForOperativeSpan`); or
 * (b) the preamble names it as a challenged decision ("proti rozsudku … sp. zn. X",
 *     a list of them, or the Constitutional Court's "vo veci namietaného porušenia …
 *     uznesením … sp. zn. X"), and the operative part names no reference at all
 *     ("Dovolanie odmieta") — then the operative part's verbs apply, with lower
 *     confidence. With several challenged decisions only an outcome under which all of
 *     them stand is applied.
 * Everything else is a mention ("ine"). Without an operative part there are no
 * outcomes at all. References to foreign or international courts are dropped.
 *
 * Outcomes found this way are still text-derived estimates; presentation must say so.
 */
export function extractDecisionRelations(input) {
    const text = input.text;
    if (!text || text.trim().length === 0)
        return [];
    // The header heuristic was measured on NS texts only; ÚS texts may open with the
    // reviewed decision's number, and ÚS refs like "II. ÚS 104/05" fail looksLikeCaseRef.
    const own = ownRefNorms(input.sourceRef, input.sourceProvider === "nsud" ? text : null);
    // Collect every match (ref text + span) from both patterns.
    const occurrences = [];
    for (const re of [CASE_REF_RE, US_REF_RE]) {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) {
            if (m.index == null)
                continue;
            const raw = m[1] ?? m[0];
            occurrences.push({ raw: raw.trim(), norm: normalizeCaseRef(raw), index: m.index, end: m.index + m[0].length });
        }
    }
    occurrences.sort((a, b) => a.index - b.index);
    const bounds = findOperativePartBounds(text);
    const operative = bounds
        ? {
            start: bounds.start,
            end: bounds.endsAtReasoning ? bounds.end : Math.min(bounds.end, bounds.start + UNBOUNDED_OPERATIVE_CAP)
        }
        : null;
    const inOperative = (index) => operative !== null && index >= operative.start && index < operative.end;
    // Group by normalized ref so one cited decision yields one relation. Self
    // occurrences stay in `occurrences`: they still bound other refs' clauses below.
    const byNorm = new Map();
    for (const occ of occurrences) {
        if (!occ.norm || own.has(occ.norm))
            continue; // skip self
        const existing = byNorm.get(occ.norm);
        if (existing)
            existing.spans.push({ index: occ.index, end: occ.end });
        else
            byNorm.set(occ.norm, { raw: occ.raw, spans: [{ index: occ.index, end: occ.end }] });
    }
    /** End of the nearest occurrence of a different reference before `index`, or 0. */
    const previousOtherEnd = (norm, index) => {
        let end = 0;
        for (const occ of occurrences) {
            if (occ.index >= index)
                break;
            if (occ.norm !== norm)
                end = Math.max(end, occ.end);
        }
        return Math.min(end, index);
    };
    const contextBefore = (norm, index, window) => text.slice(Math.max(previousOtherEnd(norm, index), index - window), index);
    /**
     * Verbs that belong to one occurrence inside the operative part: those of the first
     * stretch after it that has any, up to the end of its statement. Stretches are cut at
     * other references, so "X potvrdzuje a Y zrušuje" gives X only "potvrdzuje", while a
     * list "X a Y zrušuje a vec vracia" gives both "zrušuje". A relative clause between
     * two references ("X v časti, ktorou …") ends the list.
     */
    const verbsForOperativeSpan = (norm, span) => {
        const limit = statementEnd(text, span.end, operative.end);
        const before = verbFirstVerbs(norm, span, limit);
        if (before)
            return before;
        let from = span.end;
        for (const occ of occurrences) {
            if (occ.index < span.end || occ.index >= limit || occ.norm === norm)
                continue;
            if (occ.index > from) {
                const stretch = text.slice(from, occ.index);
                const verbs = operativeVerbs(stretch);
                if (verbs.size > 0)
                    return verbs;
                if (/ktor/u.test(foldSameLength(stretch)))
                    return verbs;
            }
            from = Math.max(from, occ.end);
        }
        return from < limit ? operativeVerbs(text.slice(from, limit)) : new Set();
    };
    /** Start of the statement holding `index`: just after the previous statement end. */
    const statementStart = (index) => {
        let start = operative.start;
        for (;;) {
            const end = statementEnd(text, start, operative.end);
            if (end >= index || end >= operative.end)
                return start;
            start = end + 1;
        }
    };
    /**
     * Verb-first statements ("Najvyšší súd z r u š u j e uznesenie Krajského súdu … sp. zn.
     * X, uznesenie Okresného súdu … ; vec vracia …"): when the statement's first verb comes
     * before its first reference, a reference takes the nearest verbs before it, plus
     * "vracia" from anywhere in the statement. Null for reference-first statements.
     */
    const verbFirstVerbs = (norm, span, limit) => {
        const start = statementStart(span.index);
        const refsBefore = occurrences.filter((occ) => occ.index >= start && occ.index < span.index && occ.norm !== norm);
        const firstRef = refsBefore[0]?.index ?? span.index;
        if (operativeVerbs(text.slice(start, firstRef)).size === 0)
            return null;
        // Walk back from the reference to the nearest stretch with verbs.
        let to = span.index;
        for (let i = refsBefore.length - 1; i >= -1; i -= 1) {
            const from = i >= 0 ? refsBefore[i].end : start;
            const stretch = text.slice(Math.min(from, to), to);
            const verbs = operativeVerbs(stretch);
            if (verbs.size > 0) {
                if (operativeVerbs(text.slice(start, limit)).has("vracia"))
                    verbs.add("vracia");
                return verbs;
            }
            if (/ktor/u.test(foldSameLength(stretch)))
                return new Set();
            if (i >= 0)
                to = refsBefore[i].index;
        }
        return null;
    };
    // (b) applies only when the operative part names no reference besides the source's own.
    const operativeNamesRef = occurrences.some((occ) => occ.norm && !own.has(occ.norm) && inOperative(occ.index));
    const challenged = new Set();
    if (operative && !operativeNamesRef) {
        const preamble = foldSameLength(text.slice(0, operative.start)).replace(/\s/g, " ");
        const usComplaint = US_COMPLAINT_RE.exec(preamble);
        let previous = null;
        for (const occ of occurrences) {
            if (occ.index >= operative.start)
                break;
            if (!occ.norm || own.has(occ.norm))
                continue;
            const before = foldSameLength(contextBefore(occ.norm, occ.index, CHALLENGED_DECISION_WINDOW)).replace(/\s+/g, " ");
            let isChallenged = CHALLENGED_DECISION_RE.test(before);
            if (!isChallenged && usComplaint && occ.index > usComplaint.index) {
                isChallenged = US_CHALLENGED_ACT_RE.test(before) && !/ktor/u.test(before);
            }
            if (!isChallenged && previous?.challenged && previous.norm !== occ.norm) {
                const gap = foldSameLength(text.slice(previous.end, occ.index)).replace(/\s+/g, " ");
                isChallenged = gap.length <= LIST_GAP_MAX && !LIST_BREAK_RE.test(gap);
            }
            if (isChallenged)
                challenged.add(occ.norm);
            previous = { norm: occ.norm, end: occ.end, challenged: isChallenged };
        }
    }
    // One operative part and several challenged decisions: an outcome under which every
    // one of them stands applies to all; a quashing or changing order is not attributed,
    // because which of them it hits is not stated.
    const operativeOutcome = operative
        ? dispositionFromVerbs(operativeVerbs(text.slice(operative.start, operative.end)))
        : "ine";
    const preambleDisposition = challenged.size === 1 || STANDING_OUTCOMES.has(operativeOutcome) ? operativeOutcome : "ine";
    const relations = [];
    for (const [norm, { raw, spans }] of byNorm) {
        if (spans.some((span) => isForeignContext(contextBefore(norm, span.index, FOREIGN_CONTEXT_WINDOW))))
            continue;
        let disposition = "ine";
        let basis = "mention";
        const operativeSpans = spans.filter((span) => inOperative(span.index));
        if (operative && operativeSpans.length > 0) {
            const verbs = new Set();
            for (const span of operativeSpans) {
                for (const verb of verbsForOperativeSpan(norm, span))
                    verbs.add(verb);
            }
            disposition = dispositionFromVerbs(verbs);
            basis = "operative";
        }
        else if (challenged.has(norm)) {
            disposition = preambleDisposition;
            basis = "preamble";
        }
        // Court name from the text immediately preceding the first occurrence.
        const firstIdx = spans[0].index;
        const targetCourt = detectCourt(text.slice(Math.max(0, firstIdx - 140), firstIdx));
        // Drop pure-noise matches: a reference with no court context and no
        // disposition is almost always a statute citation that slipped through
        // the case-ref regex (e.g. "3 ods 4/2019").
        if (targetCourt === null && disposition === "ine")
            continue;
        const confidence = disposition === "ine" || basis === "mention"
            ? CONFIDENCE.mention
            : targetCourt
                ? CONFIDENCE[basis].withCourt
                : CONFIDENCE[basis].withoutCourt;
        relations.push({
            relation: "reviews",
            targetCourt,
            targetRef: raw,
            targetRefNormalized: norm,
            targetDate: null,
            disposition,
            confidence
        });
    }
    return relations;
}
//# sourceMappingURL=relation-extractor.js.map