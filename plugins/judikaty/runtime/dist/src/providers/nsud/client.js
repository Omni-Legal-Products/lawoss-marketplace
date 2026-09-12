import { setTimeout as delay } from "node:timers/promises";
import { ZodError } from "zod/v4";
import { fetchJson } from "../../infra/http.js";
import { getDecisionCache } from "../../infra/decision-detail-cache.js";
import { buildTextWindow, downloadPdfToCache, extractPdfText, removeCachedPdf } from "../../infra/pdf.js";
import { NsudDecisionDetailSchema } from "./schemas.js";
import { buildNsudDocumentUrl } from "./mapper.js";
const NSUD_API_URL = "https://www.nsud.sk/ws/opendata.php";
/**
 * Head-probe defaults (see getLatestKnownDecisionId).
 *
 * REVISED 2026-08-10 after a second, wider round of live measurement found
 * the initial default (20) was unsafe: a contiguous void of ~46+ measured
 * (up to ~119 possible) misses sits at 219401-219519, immediately above the
 * then-current production high-water mark (219238), and a second void of
 * ~160 sits at 220819-220960 with real content confirmed on both sides of
 * each. A tolerance of 20 stops *inside* those voids on every run: the
 * high-water mark never advances, hundreds of existing decisions plus every
 * future one behind that void are never ingested, and -- because that read
 * as "we reached the head" -- nothing about it was visible.
 *
 * 250 clears both measured voids with margin (250 > 160, and the narrower
 * one's upper bound of ~119) while staying well under maxProbeSteps below,
 * so the "no more decisions" stopping condition can still fire inside a
 * single run instead of always being cut off by the step cap first.
 */
export const NSUD_HEAD_PROBE_DEFAULT_MAX_CONSECUTIVE_MISSES = 250;
/**
 * Hard cap on ids probed in a single run, independent of the miss-streak
 * counter, so a pathological run of all-hits (or a misbehaving upstream)
 * cannot make a single indexer run hang. Raised alongside the tolerance
 * above (500 -> 750) so that after crossing one full-tolerance void
 * (250 steps) a run still has real forward budget (500 steps) left in the
 * same pass, rather than the step cap firing right on the void's heels. At
 * the enforced 150ms floor, 750 steps bounds one run's probe phase to
 * ~112s. If a run doesn't fully close a large backlog it simply resumes
 * from the newly-advanced high-water mark on the next scheduled run --
 * self-healing, no data loss (see the "never lowers" guarantee below).
 *
 * A stride/jump probe (skip ahead, only dense-scan on a hit) was considered
 * and rejected: this id space has confirmed isolated far-future hits with
 * voids on both sides (e.g. hits at ~220700 and ~221100 with a miss at
 * ~220900 between them), so a stride could land on such an outlier and
 * report it as "the frontier" -- the subsequent descending backfill would
 * then walk a mostly-empty range while the real, denser frontier closer to
 * the old high-water mark stays undiscovered. Sequential probing is
 * conservative by construction: it can only report a head it walked to
 * contiguously (module the tolerated void width), which is exactly the
 * property needed here.
 */
export const NSUD_HEAD_PROBE_DEFAULT_MAX_STEPS = 750;
export const NSUD_HEAD_PROBE_DEFAULT_THROTTLE_MS = 200;
/**
 * NS SR is a public court system ("an aggressive IP gets banned"). This
 * floor applies unconditionally to the probe's own upstream calls,
 * regardless of what throttle a caller configures elsewhere -- including 0,
 * as used by the `index:nsud-law:smoke` script. (Prod's
 * NSUD_INDEX_THROTTLE_MS is 250, already above this floor; docs/OPERATIONS.md
 * previously said 100, which was a stale doc line, not the deployed value.)
 */
const NSUD_HEAD_PROBE_MIN_THROTTLE_MS = 150;
/**
 * How far back `getLatestKnownDecisionId`'s seed call looks via
 * `getLastDecision&date=...`.
 *
 * REVISED 2026-08-11 after live measurement found the seed was previously
 * passed `date=1900-01-01`, which does NOT mean "everything, ever" on this
 * portal -- verified live: it returns the OLDEST 1000 ids on record
 * (122551, 122552, ... nowhere near the actual head near 246700+), because
 * the endpoint returns ids ascending from the given date and truncates at
 * 1000 once the window contains more than that. `?getLastDecision` with NO
 * date at all returns `[]` (the long-documented "dead endpoint" symptom --
 * `date` is a required parameter, not optional).
 *
 * Confirmed live on 2026-08-11 (today):
 *   - `date=<today>`      -> 4 ids, max 246726
 *   - `date=2026-08-01`   -> 60 ids,  min 246657, max 246726 (10-day window)
 *   - `date=2026-07-01`   -> 310 ids, min 246332, max 246726 (41-day window,
 *     well under the 1000 cap, and its max matches the same-day query exactly
 *     -- so a 41-day window is provably wide enough to still reach the head)
 *   - `date=2026-01-01`   -> 1000 ids (~223-day window; CAPPED)
 *   - `date=1900-01-01`   -> 1000 ids starting at 122551 (CAPPED, and
 *     nowhere near current; proves a capped response is the OLDEST 1000 in
 *     the window, not the newest -- a too-early date silently loses the
 *     head entirely rather than erroring)
 *
 * Observed publication rate is therefore roughly 6-8 decisions/day. 30 days
 * gives real margin under the 1000 cap (a 41-day window only reached 310;
 * even a 3x burst across the busiest 30 days would land near 720-900), while
 * still being wide enough that a short portal hiccup on any single day
 * cannot make the seed miss the head. See the `ids.length >= 1000` guard in
 * `getLatestKnownDecisionId` below for what happens if this margin is ever
 * wrong for a future traffic pattern.
 */
export const NSUD_HEAD_SEED_LOOKBACK_DAYS = 30;
function computeHeadSeedSinceDate() {
    const lookbackMs = NSUD_HEAD_SEED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    return new Date(Date.now() - lookbackMs).toISOString().slice(0, 10);
}
export class NsudClient {
    /**
     * Determines the highest NSUD decision id we can currently trust exists,
     * combining (in order of trust):
     *
     *  1. getLastDecisionIds seeded with a bounded recent-date window (see
     *     NSUD_HEAD_SEED_LOOKBACK_DAYS above) -- as of 2026-08-11 this is the
     *     PRIMARY signal: live measurement confirmed `getLastDecision&date=...`
     *     works and returns ids right up to the true head in one cheap call,
     *     once called with a real, bounded date instead of the previous
     *     `1900-01-01` (which this endpoint silently mishandles -- see the
     *     constant's comment). This is what actually closes the multi-year gap
     *     that an upward probe alone would take dozens of runs to cross.
     *  2. An upward existence probe starting just above `knownHighWaterMark`,
     *     asking getDecisionDetailIfExists for successive ids until either
     *     NSUD_HEAD_PROBE_DEFAULT_MAX_CONSECUTIVE_MISSES consecutive misses or
     *     NSUD_HEAD_PROBE_DEFAULT_MAX_STEPS total probes is reached. Kept as a
     *     fallback/gap-closer: it does not depend on any upstream query
     *     parameter being honored, so it still finds a new head if the seed
     *     above ever regresses to the old "always empty" or "always oldest
     *     page" failure modes again, and it can also close small day-to-day
     *     gaps the seed's lookback window happens to miss.
     *
     *     REVISED 2026-08-11: this probe is now SKIPPED entirely whenever
     *     signal 1 (the seed) already found a candidate strictly above
     *     `knownHighWaterMark` on its own. Once the seed has proven a head
     *     exists above the mark, walking id-by-id from just above the SAME
     *     mark to look for the same thing is pure duplicate work -- up to
     *     NSUD_HEAD_PROBE_DEFAULT_MAX_STEPS (750) wasted upstream requests
     *     every single night, against a public court portal that bans
     *     aggressive IPs (see "Stopping the redundant nightly probe" in
     *     docs/NSUD_INDEXING.md). The probe still runs whenever the seed comes
     *     back empty, errors, or returns nothing above the mark -- i.e. it
     *     remains exactly the fallback it was always meant to be.
     *  3. The unfiltered searchDecisionIds endpoint -- but ONLY as a
     *     bootstrap seed when there is no known high-water mark at all (a
     *     fresh/wiped index state). NS SR is known to ignore
     *     art_datum_od/art_datum_do and to return its first page (the
     *     OLDEST ids) regardless of input, so once we have a real anchor to
     *     probe upward from, this signal must never be trusted again -- it
     *     would only ever pull the result down, not up.
     *
     * The result never falls below `knownHighWaterMark` (that value is always
     * included among the candidates), so this method alone satisfies "must
     * never lower the stored high-water mark" -- the indexer's own
     * `Math.max(state.highestKnownDecisionId ?? 0, ...)` on top is
     * belt-and-braces, not the only guard.
     *
     * Note: even with the seed now working, the *indexer's* own persisted
     * `highestKnownDecisionId` does not necessarily jump straight to this
     * method's return value in one run -- see
     * `runNsudLawIndexer`/`processAscendingGap` in `indexer.ts` for why a
     * large gap between the stored mark and this value is closed gradually,
     * across multiple bounded runs, rather than all at once.
     *
     * This method's PLAIN NUMBER return cannot distinguish "genuinely caught
     * up" from "every external signal failed and this is just the echoed
     * `knownHighWaterMark`" -- both produce `headId === knownHighWaterMark`.
     * Callers that need that distinction (anything persisting this value as a
     * fresh discovery, e.g. the indexer's `discoveredHeadDecisionId`) must use
     * `observeLatestKnownDecisionId` instead, which reports it explicitly.
     * This method is kept, unchanged in signature and behavior, for callers
     * that only ever wanted the plain number (e.g. `scripts/nsud-law-stats.ts`).
     */
    async getLatestKnownDecisionId(input) {
        return (await this.observeLatestKnownDecisionId(input)).headId;
    }
    /**
     * Same discovery logic as getLatestKnownDecisionId, but returns
     * `observedExternally` alongside the head id -- see NsudHeadObservation
     * above for exactly why that second field exists and what it must be used
     * for. This is the version indexer.ts calls before persisting a fresh
     * "discovered head", specifically to avoid mistaking "the portal was
     * completely unreachable this run" for "genuinely caught up" -- both
     * collapse to the identical `headId === knownHighWaterMark` on the plain
     * number alone.
     */
    async observeLatestKnownDecisionId(input) {
        const knownHighWaterMark = input?.knownHighWaterMark ?? null;
        const maxConsecutiveMisses = input?.maxConsecutiveMisses ?? NSUD_HEAD_PROBE_DEFAULT_MAX_CONSECUTIVE_MISSES;
        const maxProbeSteps = input?.maxProbeSteps ?? NSUD_HEAD_PROBE_DEFAULT_MAX_STEPS;
        const throttleMs = Math.max(input?.throttleMs ?? NSUD_HEAD_PROBE_DEFAULT_THROTTLE_MS, NSUD_HEAD_PROBE_MIN_THROTTLE_MS);
        const sleep = input?.sleep ?? ((ms) => delay(ms));
        const [recentIds, bootstrapIds] = await Promise.all([
            this.getLastDecisionIds({
                provider: "nsud",
                sinceDate: computeHeadSeedSinceDate(),
                limit: 1000
            }).catch(() => []),
            knownHighWaterMark === null
                ? this.searchDecisionIds({
                    provider: "nsud",
                    limit: 1000,
                    offset: 0,
                    view: "compact"
                }).catch(() => [])
                : Promise.resolve([])
        ]);
        const seedNumericIds = toNumericIds(recentIds);
        const bootstrapNumericIds = toNumericIds(bootstrapIds);
        const seedMax = seedNumericIds.length > 0 ? Math.max(...seedNumericIds) : null;
        // See the REVISED 2026-08-11 note on signal 2 above: skip the upward
        // probe entirely once the seed alone already proves a head above the
        // known mark -- there is nothing left for the probe to usefully find in
        // that case, only duplicate requests against the same low region.
        const seedAlreadyAdvancesPastMark = seedMax !== null && (knownHighWaterMark === null || seedMax > knownHighWaterMark);
        const probeResult = seedAlreadyAdvancesPastMark
            ? {
                head: null,
                stopReason: "probe_skipped_seed_advanced",
                lastProbedId: null
            }
            : await this.#probeForNewHead({
                fromIdExclusive: knownHighWaterMark,
                maxConsecutiveMisses,
                maxProbeSteps,
                throttleMs,
                sleep
            });
        // Make an exhausted tolerance observable: this is exactly the scenario
        // where the head-detection freeze would otherwise be silent -- N
        // consecutive misses reads identically whether it means "we reached the
        // real end of the data" or "we're stuck inside a wide void", so log it
        // rather than let either case pass without a trace. A run cut off by
        // the step cap instead is a normal bounded-run outcome, not this.
        if (probeResult.stopReason === "consecutive_misses_exhausted") {
            console.warn(`[nsud-client] tolerancia vyčerpaná na id ${probeResult.lastProbedId} — hlava môže byť podhodnotená ` +
                `(posledná potvrdená existencia: ${probeResult.head ?? knownHighWaterMark ?? "žiadna"}, ` +
                `prah=${maxConsecutiveMisses} po sebe idúcich chýbajúcich id).`);
        }
        // A capped seed response is silently the OLDEST 1000 ids in the window,
        // not the newest -- confirmed live (see NSUD_HEAD_SEED_LOOKBACK_DAYS'
        // comment: date=1900-01-01 returned exactly 1000 ids starting at 122551,
        // nowhere near the real head). If the lookback window ever fills past
        // this cap (a burst well above the historically observed ~6-8/day), the
        // seed's max would understate the true head without any other symptom --
        // the "green but ineffective" failure this repo's incident write-ups
        // keep coming back to. Make that observable instead of silent.
        if (recentIds.length >= 1000) {
            console.warn(`[nsud-client] getLastDecision seed vrátil ${recentIds.length} id (limit=1000) — ` +
                `odpoveď mohla byť orezaná; hlava korpusu môže byť podhodnotená z tohto zdroja. ` +
                `${seedAlreadyAdvancesPastMark
                    ? "Upward probe bola tento beh preskočená (seed už posunul hlavu nad známu značku), takže orezanie tento beh nezachytí nič navyše -- "
                    : ""}` +
                `Ďalší beh (o 24h) skúsi znovu s posunutým oknom.`);
        }
        // Whether at least one EXTERNAL signal (not the echoed knownHighWaterMark
        // itself) actually returned something this call -- see NsudHeadObservation
        // above for why this must be tracked separately from the resulting max.
        // A seed/probe/bootstrap result of "nothing" (empty array, or a probe
        // that never confirmed a hit) contributes no candidates here, so it
        // correctly leaves observedExternally false even though each of those
        // signals may still have made real upstream requests this call.
        const observedExternally = seedNumericIds.length > 0 || bootstrapNumericIds.length > 0 || probeResult.head !== null;
        const candidates = [
            ...seedNumericIds,
            ...bootstrapNumericIds,
            ...(probeResult.head !== null ? [probeResult.head] : []),
            ...(knownHighWaterMark !== null ? [knownHighWaterMark] : [])
        ];
        if (candidates.length === 0) {
            return { headId: null, observedExternally };
        }
        return { headId: Math.max(...candidates), observedExternally };
    }
    /**
     * Walks ids upward from `fromIdExclusive + 1`, one at a time, respecting
     * `throttleMs` between probes. Stops (and returns the highest id found to
     * exist, or null if none did) once either the consecutive-miss tolerance
     * or the hard step cap is reached -- whichever comes first -- so this
     * cannot run unbounded even against a pathological all-hits response. The
     * returned `stopReason` distinguishes "gave up after N misses in a row"
     * (which may mean the head was underestimated) from "hit the hard step
     * cap" (a normal bounded-run outcome) and "no anchor to probe from" (a
     * fresh/wiped state, see the bootstrap fallback above).
     */
    async #probeForNewHead(input) {
        if (input.fromIdExclusive === null) {
            return { head: null, stopReason: "no_anchor", lastProbedId: null };
        }
        let candidate = input.fromIdExclusive + 1;
        let consecutiveMisses = 0;
        let steps = 0;
        let foundHead = null;
        let lastProbedId = null;
        while (consecutiveMisses < input.maxConsecutiveMisses && steps < input.maxProbeSteps) {
            const detail = await this.getDecisionDetailIfExists(String(candidate));
            steps += 1;
            lastProbedId = candidate;
            if (detail) {
                foundHead = candidate;
                consecutiveMisses = 0;
            }
            else {
                consecutiveMisses += 1;
            }
            candidate += 1;
            const shouldContinue = consecutiveMisses < input.maxConsecutiveMisses && steps < input.maxProbeSteps;
            if (shouldContinue) {
                await input.sleep(input.throttleMs);
            }
        }
        return {
            head: foundHead,
            stopReason: consecutiveMisses >= input.maxConsecutiveMisses
                ? "consecutive_misses_exhausted"
                : "max_steps_reached",
            lastProbedId
        };
    }
    async searchDecisionIds(input) {
        const url = new URL(NSUD_API_URL);
        url.search = "?searchDecision";
        if (input.spisovaZnacka)
            url.searchParams.set("nazov", input.spisovaZnacka);
        else if (input.query)
            url.searchParams.set("art_obsah", input.query);
        if (input.ecli)
            url.searchParams.set("art_ecli", input.ecli);
        if (input.dateFrom)
            url.searchParams.set("art_datum_od", input.dateFrom);
        if (input.dateTo)
            url.searchParams.set("art_datum_do", input.dateTo);
        if (input.citedLaw)
            url.searchParams.set("art_obsah", input.citedLaw);
        // `decisionForm` is deliberately never sent upstream. `art_merito` -- the
        // only upstream param that name could plausibly map to -- is a free-text
        // search over the short merit-summary phrase, not a decision-type/
        // category filter: live-verified (2026-08-11), `art_merito=Rozsudok`
        // against a real spisovaZnacka that resolves to exactly one decision on
        // its own (`?searchDecision&nazov=1Ndob/6/2026` -> `["246716"]`) zeroed
        // that same result (`&art_merito=Rozsudok` -> `[]`), and `art_merito`
        // values for real decision-form words each match only a small, arbitrary
        // slice of a ~161k-decision corpus consisting almost entirely of those
        // forms -- impossible counts for an actual category filter. Silently
        // sending decisionForm there previously deleted genuine results instead
        // of leaving them alone; see `search-filter-capabilities.ts` (declares
        // `decisionForm: false` for nsud) and
        // `provider.ts#detectNsudDecisionFormUnavailable` (surfaces why, and
        // points to `provider="justice"`, which has a real form filter). Do not
        // resurrect an `art_merito` write here for `decisionForm`; if genuine
        // merit-summary text search is ever wanted, it belongs behind its own,
        // separately named input field (e.g. `meritQuery`), never under the
        // `decisionForm` name.
        const response = await fetchJson(url);
        return parseIdList(response);
    }
    async getDecisionDetail(id) {
        return getDecisionCache("nsud", "detail").getOrLoad(id, async () => {
            const url = new URL(NSUD_API_URL);
            url.search = "?getDecision";
            url.searchParams.set("id", id);
            const response = await fetchJson(url);
            return NsudDecisionDetailSchema.parse(response);
        });
    }
    /**
     * Tri-state fetch of a single decision id -- see NsudDecisionFetchOutcome
     * above for what each status means and why the distinction exists.
     *
     * The NS portal answers a nonexistent id with a bare `[]`, which is a
     * *successful* HTTP response (fetchJson returns it normally) but fails
     * NsudDecisionDetailSchema's object-shape parse with a ZodError -- that is
     * the live-verified signal this method uses to classify "absent". Every
     * other failure (fetchJson's HttpError/EmptyResponseError after its own
     * retries, a raw network/TypeError, an AbortError, ...) means the id was
     * never actually checked, so it is classified "fetch-failed" instead of
     * being silently folded into "absent" the way the old boolean-ish
     * `getDecisionDetailIfExists` did. Callers whose progress must not skip an
     * unconfirmed id (the indexer's high-water-mark walk) branch on this
     * distinction directly; callers that only ever treated "not found" as
     * "move on" (the head probe, the text-backfill retry queue) keep using
     * getDecisionDetailIfExists below, which collapses both non-exists cases
     * back to `null` for backwards compatibility.
     */
    async getDecisionFetchOutcome(id) {
        let detail;
        try {
            detail = await this.getDecisionDetail(id);
        }
        catch (error) {
            if (error instanceof ZodError) {
                return { status: "absent" };
            }
            return { status: "fetch-failed", error };
        }
        // NsudDecisionDetailSchema has every field optional, so an upstream `{}`
        // body (as opposed to `[]`, which correctly fails the object parse above)
        // parses successfully. That must not count as an existing decision --
        // require some real content before treating this as a hit, or a
        // content-free response would inflate both the head probe and the
        // regular backfill walk.
        if (!hasRealContent(detail)) {
            return { status: "absent" };
        }
        return { status: "exists", detail };
    }
    /**
     * Back-compat convenience wrapper over getDecisionFetchOutcome that
     * collapses "absent" and "fetch-failed" into a single `null`. Kept for
     * callers where that collapse was always the intended behavior (the
     * upward head probe, the text-backfill retry queue -- both already retry
     * indefinitely via their own separate mechanisms, so folding a transient
     * failure into "not found this time" does not lose anything permanently
     * there). Do NOT use this for any caller that persists a cursor/mark past
     * the ids it checks -- use getDecisionFetchOutcome directly instead, see
     * its doc comment.
     */
    async getDecisionDetailIfExists(id) {
        const outcome = await this.getDecisionFetchOutcome(id);
        return outcome.status === "exists" ? outcome.detail : null;
    }
    async getLastDecisionIds(input) {
        const url = new URL(NSUD_API_URL);
        url.search = "?getLastDecision";
        url.searchParams.set("date", input.sinceDate ?? new Date().toISOString().slice(0, 10));
        const response = await fetchJson(url);
        return parseIdList(response);
    }
    async resolveDecisionIdentity(input) {
        if (input.providerId) {
            return input.providerId;
        }
        const ids = await this.searchDecisionIds({
            provider: "nsud",
            ecli: input.ecli,
            spisovaZnacka: input.spisovaZnacka,
            limit: 1,
            offset: 0,
            view: "compact"
        });
        return ids[0] ?? null;
    }
    async findDecisionIdsByLaw(input) {
        const query = input.paragraph ? `${input.law} ${input.paragraph}` : input.law;
        return this.searchDecisionIds({
            provider: "nsud",
            query,
            limit: input.limit,
            offset: input.offset,
            view: input.view
        });
    }
    async getDecisionText(id, _input) {
        return this.getDecisionDetail(id);
    }
    async resolveDecisionText(id, detail, options) {
        const resolvedDetail = detail ?? (await this.getDecisionDetail(id));
        const inlineText = resolvedDetail.obsah?.trim();
        if (inlineText) {
            return {
                text: inlineText,
                sourceMode: "inline"
            };
        }
        if (!isPdfDocumentPath(resolvedDetail.subor)) {
            if (options?.allowUnavailable) {
                return {
                    text: "",
                    sourceMode: "inline"
                };
            }
            throw new Error(`NSUD decision document is not a PDF for ${id}: ${resolvedDetail.subor ?? "unknown"}`);
        }
        let downloaded;
        try {
            downloaded = await this.downloadDecisionDocument({
                provider: "nsud",
                id
            }, resolvedDetail);
        }
        catch (error) {
            if (options?.allowUnavailable) {
                return {
                    text: "",
                    sourceMode: "inline"
                };
            }
            throw error;
        }
        if (!downloaded.savedPath) {
            if (options?.allowUnavailable) {
                return {
                    text: "",
                    sourceMode: "inline"
                };
            }
            return {
                text: "",
                sourceMode: "inline"
            };
        }
        try {
            const text = await extractPdfText(downloaded.savedPath);
            await removeCachedPdf(downloaded.savedPath);
            return {
                text,
                sourceMode: "pdf_extract"
            };
        }
        catch (error) {
            await removeCachedPdf(downloaded.savedPath);
            if (options?.allowUnavailable) {
                return {
                    text: "",
                    sourceMode: "inline"
                };
            }
            throw error;
        }
    }
    async downloadDecisionDocument(input, detail) {
        const resolvedDetail = detail ?? (await this.getDecisionDetail(input.id));
        const sourceUrl = buildNsudDocumentUrl(resolvedDetail.subor);
        if (!sourceUrl) {
            throw new Error(`NSUD decision document is unavailable for ${input.id}`);
        }
        const downloaded = await downloadPdfToCache({
            provider: "nsud",
            url: sourceUrl,
            preferredFileName: resolvedDetail.subor?.split("/").pop() ?? `${input.id}.pdf`
        });
        return {
            provider: "nsud",
            id: input.id,
            fileName: resolvedDetail.subor?.split("/").pop() ?? null,
            contentType: resolvedDetail.subor?.toLowerCase().endsWith(".pdf")
                ? "application/pdf"
                : null,
            sourceUrl,
            savedPath: downloaded.savedPath,
            sizeBytes: downloaded.sizeBytes
        };
    }
    async getDecisionTextWindow(input) {
        const { text, sourceMode } = await this.resolveDecisionText(input.id);
        return buildTextWindow({
            provider: "nsud",
            id: input.id,
            text,
            offsetChars: input.offsetChars,
            maxChars: input.maxChars,
            sourceMode
        });
    }
    async getProviderHealth() {
        try {
            const ids = await this.getLastDecisionIds({
                provider: "nsud",
                sinceDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                limit: 1
            });
            return {
                ok: ids.length >= 0,
                notes: [`Live getLastDecision reachable. returned=${ids.length}`]
            };
        }
        catch (error) {
            return {
                ok: false,
                notes: [error instanceof Error ? error.message : "Unknown provider health error."]
            };
        }
    }
}
function hasRealContent(detail) {
    return Boolean(detail.cislo?.trim() || detail.datum?.trim());
}
function isPdfDocumentPath(value) {
    return typeof value === "string" && value.trim().toLowerCase().endsWith(".pdf");
}
function parseIdList(payload) {
    if (!Array.isArray(payload)) {
        return [];
    }
    return payload.filter((item) => typeof item === "string" && item.length > 0);
}
function toNumericIds(ids) {
    return ids
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isFinite(id) && id > 0);
}
//# sourceMappingURL=client.js.map