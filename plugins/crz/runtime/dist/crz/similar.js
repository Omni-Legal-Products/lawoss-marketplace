import { getContract } from "./contract.js";
import { searchContracts } from "./search.js";
const STOP_WORDS = new Set([
    "a", "alebo", "ako", "ale", "az", "až", "by", "co", "co?", "ci", "či",
    "do", "ho", "i", "ich", "im", "ja", "je", "k", "ked", "keď", "kto",
    "ktora", "ktorá", "ktore", "ktoré", "ktory", "ktorý", "len", "ma", "má",
    "mam", "mám", "me", "mi", "mu", "na", "nad", "nam", "nám", "nas", "nás",
    "ne", "nie", "o", "od", "po", "pod", "pre", "preto", "pri", "pre", "s",
    "sa", "si", "so", "som", "su", "sú", "ta", "tak", "tam", "te", "ti",
    "to", "tu", "ty", "tym", "tým", "u", "v", "vo", "vy", "z", "za",
    "zmluva", "zmluvy", "dohoda", "dohody", "objednavka", "objednávka",
    "the", "and", "of", "to", "for", "in", "on", "at",
]);
function toKeywords(s, max = 6) {
    if (!s)
        return [];
    const norm = s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const tokens = norm.split(/\s+/).filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
    const freq = new Map();
    for (const t of tokens)
        freq.set(t, (freq.get(t) ?? 0) + 1);
    return Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, max)
        .map(([t]) => t);
}
function add(bag, row, weight, reason) {
    const existing = bag.rows.get(row.id);
    if (existing) {
        existing.score += weight;
        existing.reasons.add(reason);
    }
    else {
        bag.rows.set(row.id, { row, score: weight, reasons: new Set([reason]) });
    }
}
export async function findSimilar(seed, limit = 10) {
    return (await findSimilarDetailed(seed, limit)).results;
}
/**
 * Like `findSimilar`, but also reports sub-searches that failed, so an empty
 * candidate list is never mistaken for "nothing similar exists".
 */
export async function findSimilarDetailed(seed, limit = 10) {
    const warnings = [];
    const failed = (what, err) => warnings.push(`search_failed: ${what} — ${err?.message ?? String(err)}; candidates from it are missing.`);
    const bag = { rows: new Map() };
    let seedId;
    let dodavatel;
    let objednavatel;
    let keywords = [];
    if (seed.id != null) {
        const contract = await getContract(seed.id);
        seedId = contract.id;
        dodavatel = seed.parties?.dodavatel ?? contract.dodavatel?.name;
        objednavatel = seed.parties?.objednavatel ?? contract.objednavatel?.name;
        keywords = seed.keywords?.length ? seed.keywords : toKeywords(contract.nazov ?? contract.predmet);
    }
    else {
        dodavatel = seed.parties?.dodavatel;
        objednavatel = seed.parties?.objednavatel;
        keywords = seed.keywords ?? [];
    }
    const searches = [];
    if (dodavatel) {
        searches.push((async () => {
            try {
                const r = await searchContracts({ dodavatel, limit: 30 });
                for (const row of r.results)
                    add(bag, row, 2, `dodavatel:${dodavatel}`);
            }
            catch (e) {
                failed(`dodavatel:${dodavatel}`, e);
            }
        })());
    }
    if (objednavatel) {
        searches.push((async () => {
            try {
                const r = await searchContracts({ objednavatel, limit: 30 });
                for (const row of r.results)
                    add(bag, row, 2, `objednavatel:${objednavatel}`);
            }
            catch (e) {
                failed(`objednavatel:${objednavatel}`, e);
            }
        })());
    }
    for (const kw of keywords.slice(0, 3)) {
        searches.push((async () => {
            try {
                const r = await searchContracts({ q: kw, limit: 30 });
                for (const row of r.results)
                    add(bag, row, 1, `keyword:${kw}`);
            }
            catch (e) {
                failed(`keyword:${kw}`, e);
            }
        })());
    }
    await Promise.all(searches);
    const out = [];
    for (const [id, v] of bag.rows.entries()) {
        if (seedId && id === seedId)
            continue;
        out.push({ ...v.row, score: v.score, reasons: Array.from(v.reasons) });
    }
    out.sort((a, b) => b.score - a.score);
    return { results: out.slice(0, limit), warnings };
}
//# sourceMappingURL=similar.js.map