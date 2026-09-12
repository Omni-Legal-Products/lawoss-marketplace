import * as z from "zod/v4";
import { countNsudLawIndexRecords, loadNsudLawIndexState } from "../providers/nsud/law-index-store.js";
import { asToolResult } from "../server/response.js";
/**
 * `highestKnownDecisionId`'s meaning changed with the 2026-08-11 bounded
 * gap-catchup fix (docs/OPERATIONS.md, "Correction, 2026-08-11"). It no
 * longer means "the highest NS decision id known to exist upstream" -- it
 * means "verified up to this id, contiguously" by the nightly catch-up walk.
 * The two differ by however much of the discovered head the catch-up has not
 * yet walked (production measured this at ~26,700 ids on 2026-08-11).
 *
 * Exception: on a fresh or wiped state (no prior highestKnownDecisionId),
 * the very first run seeds this value directly from the freshly discovered
 * head with NO id-by-id verification at all -- see `runNsudLawIndexer` in
 * src/providers/nsud/indexer.ts. `mode`/`nextDecisionId` do not reliably
 * distinguish the two cases from this tool's output alone; treat a small
 * `processed`/`skipped` history alongside a large `highestKnownDecisionId`
 * as a signal you may be looking at an unverified seed, not a verified mark.
 */
export const HIGHEST_KNOWN_DECISION_ID_MEANING = 'Verified up to this id, contiguously, by the bounded nightly gap-catchup walk. ' +
    'NOT "the highest NS decision id known to exist upstream" -- that is the ' +
    "discovered head, which this tool cannot report (see headGapNote). On a " +
    "fresh/wiped state the very first run seeds this value straight from the " +
    "discovered head, unverified -- see docs/TOOLS_SPEC.md.";
/**
 * As of commit b1430cb (`.superpowers/fixes/ingestion-correctness-report.md`),
 * `NsudLawIndexState` persists `discoveredHeadDecisionId`: the raw NS
 * decision id `NsudClient.getLatestKnownDecisionId` discovered on the most
 * recent indexer run, UNVERIFIED (unlike `highestKnownDecisionId`, which
 * means "verified up to this id, contiguously" -- see
 * HIGHEST_KNOWN_DECISION_ID_MEANING above) and monotonic (never regresses
 * across runs). When present, `remainingToHead` is simply
 * `discoveredHeadDecisionId - highestKnownDecisionId`, floored at 0 as a
 * defensive measure (the two are documented to never invert in practice).
 *
 * The field is still absent (not `null` -- the JSON key itself is missing,
 * see `loadNsudLawIndexState`) on any state row written before that fix
 * landed, until the next `index:nsud-law` run writes a fresh one. That is
 * the normal, expected state right after a fresh deploy, not an error --
 * `headGapObservable` is `false` and `headGapNote` explains why rather than
 * reporting a real number.
 */
export const HEAD_GAP_OBSERVABLE_NOTE = "discoveredHeadDecisionId is the raw NS decision id the most recent " +
    "indexer run discovered, UNVERIFIED (unlike highestKnownDecisionId, which " +
    "means 'verified up to this id, contiguously'). remainingToHead = " +
    "discoveredHeadDecisionId - highestKnownDecisionId, floored at 0.";
export const HEAD_GAP_NOT_YET_AVAILABLE_NOTE = "discoveredHeadDecisionId/remainingToHead are null: this state row either " +
    "predates the indexer change that persists the discovered head (normal " +
    "right after a fresh deploy -- wait for the next nightly run of " +
    "index:nsud-law, not an error), or the indexer has not yet discovered a " +
    "head at all (fresh/wiped state with no cursor). Run `npm run " +
    // `:dev` runs via tsx, which the production image does not install
    // (`npm ci --omit=dev`) -- the plain `index:nsud-law:stats` script runs
    // the compiled dist/scripts build and works in prod too.
    "index:nsud-law:stats` for an on-demand live check meanwhile.";
/** Pure: builds the tool's payload from already-loaded data. No I/O here --
 * that stays in the caller, so this stays cheap to test and impossible to
 * accidentally turn into an upstream call from the request path. */
export function buildNsudIndexStats(records, state) {
    const mode = state.nextDecisionId === null && typeof state.highestKnownDecisionId === "number"
        ? "recent-only"
        : "backfill";
    const indexedCursorSpan = typeof state.highestKnownDecisionId === "number" && typeof state.nextDecisionId === "number"
        ? state.highestKnownDecisionId - state.nextDecisionId
        : null;
    const headGapObservable = typeof state.discoveredHeadDecisionId === "number";
    const discoveredHeadDecisionId = headGapObservable ? state.discoveredHeadDecisionId : null;
    const remainingToHead = headGapObservable && typeof state.highestKnownDecisionId === "number"
        ? Math.max(0, discoveredHeadDecisionId - state.highestKnownDecisionId)
        : null;
    return {
        records,
        mode,
        lastRunAt: state.lastRunAt,
        processed: state.processed,
        skipped: state.skipped ?? 0,
        nextDecisionId: state.nextDecisionId ?? null,
        lastIndexedDecisionId: state.lastIndexedDecisionId ?? null,
        highestKnownDecisionId: state.highestKnownDecisionId ?? null,
        indexedCursorSpan,
        discoveredHeadDecisionId,
        remainingToHead,
        headGapObservable,
        headGapNote: headGapObservable ? HEAD_GAP_OBSERVABLE_NOTE : HEAD_GAP_NOT_YET_AVAILABLE_NOTE
    };
}
export function registerGetNsudIndexStatsTool(server) {
    server.registerTool("get_nsud_index_stats", {
        title: "Get NSUD Law-Index Stats",
        description: "Return the size and backfill cursor of the persisted NSUD law citation index. " +
            "highestKnownDecisionId means 'verified up to this id' (not 'highest id on the " +
            "portal') since the 2026-08-11 bounded catch-up fix. discoveredHeadDecisionId " +
            "(unverified) and remainingToHead are populated once the indexer has persisted " +
            "a discovered head for this state row (headGapObservable=true); see headGapNote " +
            "when they are still null.",
        inputSchema: z.object({}).shape
    }, async () => {
        const [records, state] = await Promise.all([
            countNsudLawIndexRecords(),
            loadNsudLawIndexState()
        ]);
        return asToolResult(buildNsudIndexStats(records, state));
    });
}
//# sourceMappingURL=get-nsud-index-stats.js.map