import { parseIsoDateOnly } from "../../domain/merge.js";
/**
 * Hydration (`hydrate.ts`) can replace a `metadata_only` item with a
 * freshly fetched live detail whose `dateIssued` was never checked against
 * a requested date range: the pre-fetch guards
 * (`single.ts`/`auto.ts`#applyDateRangeGuard) and the local nsud-index
 * route's own SQL predicate only cover what was originally returned, not
 * what hydration substituted in.
 *
 * This is deliberately NOT `domain/merge.ts#applyDateRangeGuard` reused
 * under a synthetic provider id (an earlier version of this fix did that,
 * and it was wrong on inspection): `applyDateRangeGuard` is a per-provider,
 * PRE-merge function, and calling it on an already-merged,
 * already-hydrated, possibly-multi-provider result corrupts it in three
 * ways:
 *
 *  1. `providerBreakdown` gains a key for the fake "provider" passed in
 *     (e.g. `"post-hydration"`), while the real per-provider counts go
 *     stale and no longer sum to `items.length`. `providerBreakdown` is a
 *     `z.record(z.string(), ...)`, so nothing in the schema rejects this.
 *  2. A single hydrated item drifting out of range sets
 *     `totalIsProvenUnreliable` and rewrites the WHOLE merged `total` down
 *     to this page's kept-item count -- destroying a number (e.g. a true
 *     upstream total of 5000+) that was already honestly computed before
 *     hydration ever ran, and which can flip `buildSearchFallbackBoundary`
 *     into suggesting a fallback that isn't warranted.
 *  3. The generated notes blame a `"post-hydration"` "provider" for
 *     "unreliable upstream date filtering" and a "reported total=N
 *     upstream" that it neither is nor reported.
 *
 * Instead: a hydrated item that fails verification falls BACK to its
 * pre-hydration version -- which WAS already range-verified, either by the
 * SQL predicate on the local nsud route or by the pre-fetch guard on the
 * live path -- so nothing that was correctly in range disappears, and
 * `items.length` / `total` / `providerBreakdown` are always left exactly
 * as they were. Only a purpose-written note is added, and only when a
 * fallback actually happened.
 */
export function reconcilePostHydrationDates(preHydration, hydrated, input) {
    const dateFrom = parseIsoDateOnly(input.dateFrom);
    const dateTo = parseIsoDateOnly(input.dateTo);
    if (!dateFrom && !dateTo) {
        return hydrated;
    }
    const preHydrationByKey = new Map(preHydration.items.map((item) => [`${item.provider}:${item.providerId}`, item]));
    let fallbackCount = 0;
    const items = hydrated.items.map((item) => {
        const issued = parseIsoDateOnly(item.dateIssued);
        const inRange = issued !== null && (!dateFrom || issued >= dateFrom) && (!dateTo || issued <= dateTo);
        if (inRange) {
            return item;
        }
        const original = preHydrationByKey.get(`${item.provider}:${item.providerId}`);
        if (!original) {
            // Structurally should not happen -- hydrate.ts always preserves
            // provider/providerId on the item it substitutes in. There is
            // nothing safe to fall back to, so the hydrated item is kept rather
            // than dropped: dropping would still violate the "leave
            // items/total/providerBreakdown untouched" contract this function
            // exists to uphold.
            return item;
        }
        fallbackCount += 1;
        return original;
    });
    if (fallbackCount === 0) {
        return { ...hydrated, items };
    }
    return {
        ...hydrated,
        items,
        coverageNotes: [
            ...hydrated.coverageNotes,
            `post-hydration: ${fallbackCount} hydrated item(s) reported a dateIssued outside the requested ` +
                `date range (dateFrom=${dateFrom ?? "(none)"} dateTo=${dateTo ?? "(none)"}); the pre-hydration ` +
                "version of each (already range-verified before hydration ran) was kept instead of the freshly " +
                "fetched detail, so total and providerBreakdown are unaffected."
        ]
    };
}
//# sourceMappingURL=hydration-date-guard.js.map