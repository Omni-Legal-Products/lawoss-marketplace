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
const WHOLE_US_REF_RE = /^[IVX]{1,4}\.?\s?[ÚU]S\s?\d{1,4}\/\d{4}$/u;
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
    "vracia"
]);
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
    if (verbs.has("odmieta"))
        return "odmietnute";
    if (verbs.has("zamieta"))
        return "zamietnute";
    return "ine";
}
/** "na odvolanie … proti rozsudku Okresného súdu … č. k. 5C/1/2019" — the challenged decision. */
const CHALLENGED_DECISION_RE = /\bproti (?:\p{L}+ ){0,2}(?:rozsudku|uzneseniu|rozhodnutiu|rozkazu|vyroku|vyrokom|nalezu)\b/u;
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
 *     follow it within its clause (up to the next other reference); or
 * (b) the preamble names it as the challenged decision ("proti rozsudku … sp. zn. X"),
 *     it is the only such reference, and the operative part names no reference at all
 *     ("Rozsudok súdu prvej inštancie potvrdzuje") — then the operative part's verbs
 *     apply, with lower confidence.
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
    /** Start of the nearest occurrence of a different reference after `index`, or `limit`. */
    const nextOtherStart = (norm, index, limit) => {
        for (const occ of occurrences) {
            if (occ.index > index && occ.norm !== norm)
                return Math.min(occ.index, limit);
        }
        return limit;
    };
    const contextBefore = (norm, index, window) => text.slice(Math.max(previousOtherEnd(norm, index), index - window), index);
    // (b) applies only when the operative part names no reference besides the source's own.
    const operativeNamesRef = occurrences.some((occ) => occ.norm && !own.has(occ.norm) && inOperative(occ.index));
    const challenged = new Set();
    if (operative && !operativeNamesRef) {
        for (const [norm, { spans }] of byNorm) {
            const named = spans.some((span) => span.index < operative.start &&
                CHALLENGED_DECISION_RE.test(foldSameLength(contextBefore(norm, span.index, CHALLENGED_DECISION_WINDOW)).replace(/\s+/g, " ")));
            if (named)
                challenged.add(norm);
        }
    }
    // Two challenged decisions and one operative part: which verb belongs to which is unknown.
    const preambleDisposition = operative && challenged.size === 1
        ? dispositionFromVerbs(operativeVerbs(text.slice(operative.start, operative.end)))
        : "ine";
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
                const clauseEnd = nextOtherStart(norm, span.index, operative.end);
                if (clauseEnd > span.end)
                    for (const verb of operativeVerbs(text.slice(span.end, clauseEnd)))
                        verbs.add(verb);
            }
            disposition = dispositionFromVerbs(verbs);
            basis = "operative";
        }
        else if (challenged.has(norm) && challenged.size === 1) {
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