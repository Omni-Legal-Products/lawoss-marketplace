import * as z from "zod/v4";
import { getRelationsReviewing, getRelationsBySourceRef, recordRefLookup } from "../providers/nsud/law-index-store.js";
import { normalizeCaseRef } from "../domain/relation-extractor.js";
import { pickModelOverlay } from "../domain/relation-model-labels.js";
import { asToolResult } from "../server/response.js";
import { isTextEstimate, TEXT_ESTIMATE_SUFFIX } from "./search-decisions/treatment-flags.js";
const InputShape = {
    spisovaZnacka: z
        .string()
        .min(2)
        .describe("Spisová značka rozhodnutia, ktorého osud chceš preveriť (napr. krajského alebo okresného súdu). " +
        "Tolerantné na medzery a oddeľovače: '5 Co 55/2009' = '5Co/55/2009'.")
};
/**
 * Every lookup matches the spisová značka alone. The same number exists at several
 * courts (5Co/1/2020 is a file at the regional courts in Žilina, Trenčín and Nitra),
 * so the tool always says so, and `ambiguityNote` says when the rows show it.
 */
export const REF_ONLY_MATCHING_NOTE = "Vzťahy sa párujú len podľa spisovej značky, bez súdu — tá istá značka môže existovať na viacerých súdoch.";
const COVERAGE_NOTE = "Výsledok vychádza z lokálne indexovaného korpusu. Neprítomnosť zásahu vyššieho súdu " +
    "NEZNAMENÁ, že rozhodnutie nebolo preskúmané — len že sa to v indexovaných rozhodnutiach nenašlo. " +
    REF_ONLY_MATCHING_NOTE;
const ADVERSE = new Set(["zrusene", "zrusene_vratene", "zmenene"]);
const STANDS = new Set(["odmietnute", "zamietnute", "zastavene"]);
const isEstimate = (r) => r.dispositionSource === "model-estimate";
const isVerified = (r) => r.verifiedBy === "model";
/**
 * The entry a status rests on: a model-verified value outranks a bare heuristic one,
 * which outranks a model estimate, so a status is only phrased as an estimate when
 * nothing firmer exists.
 */
function pick(reviewedBy, test) {
    const matching = reviewedBy.filter(test);
    return matching.find(isVerified) ?? matching.find((r) => !isEstimate(r)) ?? matching[0];
}
/**
 * Every status resting on an estimate says so: a model's (design 2026-09-25, R7) or
 * the text extractor's (audit 2026-10-09, J2).
 */
function sentence(text, entry) {
    if (isEstimate(entry))
        return `${text} (odhad modelu).`;
    if (isTextEstimate(entry))
        return `${text}${TEXT_ESTIMATE_SUFFIX}.`;
    return `${text}.`;
}
function deriveStatus(reviewedBy) {
    if (reviewedBy.length === 0) {
        return "Bez zisteného zásahu vyššieho súdu v indexovanom korpuse.";
    }
    const adverse = pick(reviewedBy, (r) => ADVERSE.has(r.disposition));
    if (adverse) {
        const court = adverse.reviewingCourt ?? "vyšší súd";
        const ref = adverse.reviewingRef ?? "?";
        const what = adverse.disposition === "zmenene" ? "zmenené" : "zrušené";
        if (isEstimate(adverse)) {
            return `⚠️ POZOR: podľa modelu ${what} (odhad modelu; ${court}, ${ref}) — over v texte rozhodnutia.`;
        }
        if (isTextEstimate(adverse)) {
            return `⚠️ POZOR: podľa textu výroku ${what} (odhad z textu výroku, over v rozhodnutí; ${court}, ${ref}).`;
        }
        return `⚠️ POZOR: rozhodnutie bolo zrušené/zmenené (${court}, ${ref}).`;
    }
    // `ciastocne` comes from model labels and, since 2026-10, from mixed operative verbs.
    const partial = pick(reviewedBy, (r) => r.disposition === "ciastocne");
    if (partial) {
        return sentence("⚠️ Vyšší súd rozhodol čiastočne — časť rozhodnutia mohla byť zrušená alebo zmenená, over manuálne", partial);
    }
    // `porusenie_prava` comes only from model labels.
    const violation = pick(reviewedBy, (r) => r.disposition === "porusenie_prava");
    if (violation) {
        return sentence("Vyšší súd konštatoval porušenie práva (rozhodnutie tým nemusí byť zrušené) — over manuálne", violation);
    }
    const confirmed = pick(reviewedBy, (r) => r.disposition === "potvrdene");
    if (confirmed) {
        return sentence("Potvrdené vyšším súdom", confirmed);
    }
    const stands = pick(reviewedBy, (r) => STANDS.has(r.disposition));
    if (stands) {
        return stands.disposition === "zastavene"
            ? sentence("Vyšší súd nezasiahol (konanie o opravnom prostriedku zastavené)", stands)
            : sentence("Vyšší súd nezasiahol (opravný prostriedok/sťažnosť odmietnuté alebo zamietnuté)", stands);
    }
    // Reached also when the model demoted the only outcome to a mention; say so then.
    return sentence("Rozhodnutie spomenuté vyšším súdom — výrok nejednoznačný, over manuálne", pick(reviewedBy, () => true));
}
const COURT_LEVELS = [
    [/\bnajvyss/u, "ns"],
    [/\bustavn/u, "us"],
    [/\bkrajsk/u, "ks"],
    // A city court took over its district courts' files (Mestský súd Bratislava IV
    // decides "vo veci Okresného súdu Bratislava III"), so they are one level.
    [/\b(?:okresn|mestsk)/u, "os"],
    [/\bspecializovan/u, "scs"]
];
const NOT_A_SEAT = new Set(["v", "vo", "sr", "slovenskej", "republiky", "pre"]);
/**
 * Level and seat of a court name. The seat key is the first three letters of its first
 * two words, so the nominative and locative forms agree ("Krajský súd Trnava" and
 * "Krajský súd v Trnave" → "trn"). Generic names ("Krajský súd", as the extractor
 * records target courts) have no seat and conflict with nothing.
 */
function courtKey(name) {
    if (!name)
        return null;
    const folded = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const level = COURT_LEVELS.find(([re]) => re.test(folded))?.[1];
    if (!level)
        return null;
    const afterCourt = folded.split(/\bsud\w*\b/u).slice(1).join(" ");
    const words = afterCourt
        .split(/[^a-z]+/u)
        .filter((word) => word.length > 0 && !NOT_A_SEAT.has(word) && !/^[ivx]+$/u.test(word));
    const seat = words.slice(0, 2).map((word) => word.slice(0, 3)).join(" ");
    return { level, seat: seat.length > 0 ? seat : null };
}
/**
 * Court names among `names` that cannot all hold the same file: two courts of the
 * same level with different seats. Different levels are a normal chain (OS → KS →
 * NS → ÚS) and never conflict. Returns the conflicting names, or [] when none.
 */
export function conflictingCourts(names) {
    const seatsByLevel = new Map();
    for (const name of names) {
        const key = courtKey(name);
        if (!key?.seat || !name)
            continue;
        const seats = seatsByLevel.get(key.level) ?? new Map();
        if (!seats.has(key.seat))
            seats.set(key.seat, name.trim());
        seatsByLevel.set(key.level, seats);
    }
    const out = [];
    for (const seats of seatsByLevel.values()) {
        if (seats.size > 1)
            out.push(...seats.values());
    }
    return out;
}
/**
 * Courts that the rows attribute to file number `ref` itself, plus the regional
 * courts that reviewed it. A first-instance file is appealed to one regional court
 * only, so two regional reviewers are two different files as well.
 */
export function ambiguityNoteFor(ref, courtsOfRef, reviewingCourts) {
    const own = conflictingCourts(courtsOfRef);
    const reviewers = conflictingCourts(reviewingCourts.filter((name) => courtKey(name)?.level === "ks"));
    if (own.length === 0 && reviewers.length === 0)
        return null;
    const parts = [];
    if (own.length > 0)
        parts.push(`spis vedú rôzne súdy (${own.join(", ")})`);
    if (reviewers.length > 0)
        parts.push(`preskúmali ju rôzne krajské súdy (${reviewers.join(", ")})`);
    return (`Spisová značka ${ref} patrí v indexe zjavne viacerým veciam: ${parts.join("; ")}. ` +
        "Vzťahy sa párujú len podľa spisovej značky bez súdu, preto môžu byť zmiešané záznamy rôznych vecí — " +
        "pri každom zázname over súd.");
}
export async function buildDecisionTreatment(input) {
    const normalizedRef = normalizeCaseRef(input.spisovaZnacka);
    const [reviewingRows, forwardRows] = await Promise.all([
        getRelationsReviewing(normalizedRef),
        getRelationsBySourceRef(normalizedRef)
    ]);
    const reviewedBy = reviewingRows.map((row) => ({
        reviewingCourt: row.sourceCourt,
        reviewingRef: row.sourceRef,
        reviewingProvider: row.sourceProvider,
        reviewingId: row.sourceId,
        disposition: row.disposition,
        confidence: row.confidence,
        ...(isTextEstimate(row) ? { textEstimate: true } : {}),
        ...pickModelOverlay(row)
    }));
    const reviews = forwardRows.map((row) => ({
        reviewedCourt: row.targetCourt,
        reviewedRef: row.targetRef,
        disposition: row.disposition,
        confidence: row.confidence,
        ...(isTextEstimate(row) ? { textEstimate: true } : {}),
        ...pickModelOverlay(row)
    }));
    const ambiguityNote = ambiguityNoteFor(input.spisovaZnacka.trim(), [...forwardRows.map((row) => row.sourceCourt), ...reviewingRows.map((row) => row.targetCourt)], reviewingRows.map((row) => row.sourceCourt));
    return {
        subject: { spisovaZnacka: input.spisovaZnacka, normalizedRef },
        status: deriveStatus(reviewedBy),
        reviewedBy,
        reviews,
        coverageNote: COVERAGE_NOTE,
        ...(ambiguityNote ? { ambiguityNote } : {})
    };
}
export function registerGetDecisionTreatmentTool(server) {
    server.registerTool("get_decision_treatment", {
        title: "Decision Treatment (osud rozhodnutia)",
        description: "Zisti, či bolo rozhodnutie preskúmané vyšším súdom (Najvyšší/Ústavný súd) a s akým výrokom " +
            "(zrušené/potvrdené/zmenené/vrátené). Reverzný 'je to ešte dobrá judikatúra?' lookup nad lokálnym " +
            "indexom citácií. Vracia kompaktný štruktúrovaný výsledok, nie plné texty. Výsledok vyčítaný z textu " +
            "výroku je odhad (označený), nie overený fakt; páruje sa len podľa spisovej značky bez súdu, preto " +
            "pri rovnakej značke na viacerých súdoch sleduj ambiguityNote.",
        inputSchema: InputShape
    }, async (input) => {
        const parsed = z.object(InputShape).parse(input);
        // Checking a decision's fate by name says "I am relying on this case" far
        // more clearly than a search hit does. Recorded so the weekly report can
        // warn about these without the user hand-maintaining a watchlist.
        await recordRefLookup(parsed.spisovaZnacka);
        const treatment = await buildDecisionTreatment(parsed);
        return asToolResult(treatment);
    });
}
//# sourceMappingURL=get-decision-treatment.js.map