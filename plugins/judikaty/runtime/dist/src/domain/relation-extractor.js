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
// Higher priority = stronger / more adverse outcome, preferred when several appear.
const DISPOSITION_RULES = [
    { disposition: "zrusene_vratene", test: (w) => w.includes("zrusuje") && w.includes("vracia") },
    { disposition: "zrusene", test: (w) => w.includes("zrusuje") || w.includes("zrusil") },
    { disposition: "zmenene", test: (w) => w.includes("meni") && !w.includes("nemeni") && !w.includes("nezmeni") },
    { disposition: "potvrdene", test: (w) => w.includes("potvrdzuje") || w.includes("potvrdil") },
    { disposition: "odmietnute", test: (w) => w.includes("odmieta") },
    { disposition: "zamietnute", test: (w) => w.includes("zamieta") }
];
function despace(value) {
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, "");
}
function detectDisposition(window) {
    const w = despace(window);
    for (const rule of DISPOSITION_RULES) {
        if (rule.test(w))
            return rule.disposition;
    }
    return "ine";
}
function detectCourt(before) {
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
export function extractDecisionRelations(input) {
    const text = input.text;
    if (!text || text.trim().length === 0)
        return [];
    const sourceNorm = input.sourceRef ? normalizeCaseRef(input.sourceRef) : null;
    // Collect every match (ref text + index) from both patterns.
    const occurrences = [];
    for (const re of [CASE_REF_RE, US_REF_RE]) {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) {
            if (m.index == null)
                continue;
            const raw = m[1] ?? m[0];
            occurrences.push({ raw: raw.trim(), norm: normalizeCaseRef(raw), index: m.index });
        }
    }
    // Group by normalized ref so one cited decision yields one relation.
    const byNorm = new Map();
    for (const occ of occurrences) {
        if (!occ.norm || occ.norm === sourceNorm)
            continue; // skip self
        const existing = byNorm.get(occ.norm);
        if (existing)
            existing.indices.push(occ.index);
        else
            byNorm.set(occ.norm, { raw: occ.raw, indices: [occ.index] });
    }
    const relations = [];
    for (const [norm, { raw, indices }] of byNorm) {
        // Boundaries of every occurrence whose normalized ref differs from this one.
        // Used to prevent the disposition window from bleeding into a neighbouring
        // decision's clause.
        const otherBoundaries = occurrences
            .filter((occ) => occ.norm && occ.norm !== norm)
            .map((occ) => occ.index)
            .sort((a, b) => a - b);
        // Strongest disposition across all windows where this ref appears.
        let disposition = "ine";
        let dispositionRank = DISPOSITION_RULES.length; // higher = weaker
        for (const idx of indices) {
            const boundary = otherBoundaries.find((b) => b > idx) ?? text.length;
            const windowEnd = Math.min(idx + 260, boundary);
            const window = text.slice(idx, windowEnd);
            const found = detectDisposition(window);
            const rank = DISPOSITION_RULES.findIndex((r) => r.disposition === found);
            const effectiveRank = rank < 0 ? DISPOSITION_RULES.length : rank;
            if (effectiveRank < dispositionRank) {
                dispositionRank = effectiveRank;
                disposition = found;
            }
        }
        // Court name from the text immediately preceding the first occurrence.
        const firstIdx = indices.reduce((a, b) => (b < a ? b : a), indices[0]);
        const targetCourt = detectCourt(text.slice(Math.max(0, firstIdx - 140), firstIdx));
        const hasDisposition = disposition !== "ine";
        // Drop pure-noise matches: a reference with no court context and no
        // disposition is almost always a statute citation that slipped through
        // the case-ref regex (e.g. "3 ods 4/2019").
        if (targetCourt === null && disposition === "ine")
            continue;
        const confidence = hasDisposition && targetCourt ? 0.9 : hasDisposition ? 0.6 : 0.3;
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