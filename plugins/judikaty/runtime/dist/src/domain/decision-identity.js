/**
 * Identity clean-up shared by both search tools.
 *
 * Three defects in the upstream data, all measured on the production corpus on
 * 2026-08-03, all of which surface as wrong or wasteful search results:
 *
 *  1. The NS API's `cislo` field — mapped to spisovaZnacka — sometimes holds the
 *     subject of the proceedings ("odvolanie obžalovaného") instead of a reference.
 *  2. 41.6% of NS records (67,014 of 160,950) have no usable reference and no
 *     ECLI, and the portal has none either, so their validity cannot be checked —
 *     but the judgment states its own number in the opening lines of its text.
 *  3. The portal stores some judgments twice under two ids, one copy without
 *     metadata, so a page of results can spend the reader's tokens twice on one
 *     decision.
 *
 * Everything here happens on read. Nothing is written back, so a rule that turns
 * out to be wrong costs nothing and needs no migration over 160k records.
 */
import { asCaseRef, deriveCaseRefFromHeader, normalizeCaseRef } from "./relation-extractor.js";
export async function resolveDecisionIdentities(items, loadHeaders) {
    // 1. A value that is not a reference must not be presented as one.
    const cleaned = items.map((item) => {
        const valid = asCaseRef(item.spisovaZnacka);
        return valid === (item.spisovaZnacka ?? null) ? item : { ...item, spisovaZnacka: valid };
    });
    // 2. Recover what the portal never had, from text we already store. Only the
    //    rows that need it, and only the page being returned.
    // All three providers, not just NS: the ÚS and justice provider_records mirror is
    // sparse, so without this their references stay unknown and their validity cannot be
    // checked at all.
    const needHeader = cleaned.filter((item) => !item.spisovaZnacka && item.providerId);
    if (needHeader.length > 0) {
        const heads = await loadHeaders(needHeader.map((item) => item.providerId));
        for (const item of needHeader) {
            const derived = deriveCaseRefFromHeader(heads.get(item.providerId));
            if (!derived)
                continue;
            item.spisovaZnacka = derived.ref;
            item.spisovaZnackaSource = "derived-from-text";
        }
    }
    // 3. Collapse the portal's duplicate copies, keeping the better-described one:
    //    genuine portal metadata beats a derived reference, then ECLI breaks ties.
    const out = [];
    const seen = new Map();
    let duplicatesSuppressed = 0;
    for (const item of cleaned) {
        if (!item.spisovaZnacka) {
            out.push(item);
            continue;
        }
        const key = `${item.provider ?? "?"}:${normalizeCaseRef(item.spisovaZnacka)}`;
        const previous = seen.get(key);
        if (!previous) {
            seen.set(key, item);
            out.push(item);
            continue;
        }
        duplicatesSuppressed += 1;
        const better = (previous.spisovaZnackaSource === "derived-from-text" && !item.spisovaZnackaSource) ||
            (!previous.ecli && Boolean(item.ecli));
        if (better) {
            out[out.indexOf(previous)] = item;
            seen.set(key, item);
        }
    }
    return { items: out, duplicatesSuppressed };
}
//# sourceMappingURL=decision-identity.js.map