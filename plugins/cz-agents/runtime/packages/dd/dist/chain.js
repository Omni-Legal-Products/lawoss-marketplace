const MAX_DEPTH_LIMIT = 5;
const SEARCH_PAGE_SIZE = 50;
/**
 * Auto-skip threshold for "surname too common". If ARES reports more than
 * COMMON_SURNAME_THRESHOLD companies whose obchodniJmeno contains the
 * surname, the chain treats the surname as ambiguous (e.g. Novák, Zima,
 * Kolář on a board of a large public company) and skips it with a
 * SURNAME_TOO_COMMON note rather than producing thousands of false-positive
 * matches downstream.
 *
 * 50 is empirically calibrated: rare surnames (Krišica) hit <10 companies;
 * common Czech surnames (Novák, Svoboda, Dvořák) hit 1000+; mid-range
 * surnames (Hušek) sit around 30-100. 50 catches the "too noisy to use"
 * cohort without filtering legitimate small-business UBO patterns.
 */
const COMMON_SURNAME_THRESHOLD = 50;
export async function buildChain(rootIco, ares, opts = {}) {
    const maxDepth = Math.min(opts.maxDepth ?? 3, MAX_DEPTH_LIMIT);
    const minNameLength = opts.minNameLength ?? 5;
    const commonSurnameThreshold = opts.commonSurnameThreshold ?? COMMON_SURNAME_THRESHOLD;
    const visited = new Set([rootIco]);
    const root = await buildNode(rootIco, [], 0, maxDepth, ares, visited, minNameLength, commonSurnameThreshold);
    return {
        root_ico: rootIco,
        tree: root,
        total_companies: visited.size,
        max_depth: maxDepth,
    };
}
async function buildNode(ico, via, depth, maxDepth, ares, visited, minNameLength, commonSurnameThreshold) {
    const subject = await safeCall(() => ares.getByIco(ico));
    const node = {
        ico,
        name: subject?.obchodniJmeno,
        via,
    };
    if (depth >= maxDepth)
        return node;
    const vr = await safeCall(() => ares.getVrRecord(ico));
    if (!vr?.statutarniOrgany)
        return node;
    const personNames = [];
    for (const organ of vr.statutarniOrgany) {
        if (organ.datumVymazu)
            continue;
        for (const m of organ.clenoveOrganu ?? []) {
            if (m.datumVymazu)
                continue;
            const fo = m.fyzickaOsoba;
            if (!fo)
                continue;
            const name = [fo.jmeno, fo.prijmeni].filter(Boolean).join(' ').trim();
            if (name && name.length >= minNameLength && !personNames.includes(name)) {
                personNames.push(name);
            }
        }
    }
    const children = [];
    const skippedCommon = [];
    for (const personName of personNames) {
        const result = await findOtherCompanies(personName, ico, ares, commonSurnameThreshold);
        if (result.skipped) {
            skippedCommon.push({ name: personName, total_match_count: result.total_match_count });
            continue;
        }
        for (const co of result.companies) {
            if (visited.has(co.ico)) {
                children.push({ ico: co.ico, name: co.name, via: [...via, personName], cycle: true });
                continue;
            }
            visited.add(co.ico);
            const child = await buildNode(co.ico, [...via, personName], depth + 1, maxDepth, ares, visited, minNameLength, commonSurnameThreshold);
            children.push(child);
        }
    }
    if (children.length > 0)
        node.children = children;
    if (skippedCommon.length > 0)
        node.skipped_common_surnames = skippedCommon;
    return node;
}
async function findOtherCompanies(personName, excludeIco, ares, commonSurnameThreshold) {
    // ARES doesn't have a direct "person → companies" endpoint. We approximate
    // by searching companies whose obchodniJmeno contains the surname — known
    // to be noisy on common Czech surnames. For real UBO use ESM (separate
    // registry, future @czagents/esm). Here we auto-skip when the surname
    // matches more companies than the threshold (Novák / Zima / Kolář would
    // hit hundreds of unrelated subjects).
    const surname = personName.split(' ').pop() ?? personName;
    if (surname.length < 4) {
        return { companies: [], skipped: false, total_match_count: 0 };
    }
    const result = await safeCall(() => ares.search({ obchodniJmeno: surname, pocet: SEARCH_PAGE_SIZE }));
    if (!result)
        return { companies: [], skipped: false, total_match_count: 0 };
    const total = result.pocetCelkem ?? result.ekonomickeSubjekty.length;
    if (total > commonSurnameThreshold) {
        return { companies: [], skipped: true, total_match_count: total };
    }
    return {
        companies: result.ekonomickeSubjekty
            .filter((s) => s.ico && s.ico !== excludeIco)
            .map((s) => ({ ico: s.ico, name: s.obchodniJmeno })),
        skipped: false,
        total_match_count: total,
    };
}
async function safeCall(fn) {
    try {
        return await fn();
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=chain.js.map