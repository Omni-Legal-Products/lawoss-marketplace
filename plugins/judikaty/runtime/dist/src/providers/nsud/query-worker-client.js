/**
 * Client for the read-only query worker pool.
 *
 * Disabled by default so CLI/cron scripts (which are already separate processes
 * and own the write path) keep using the in-process store. The HTTP server turns
 * it on at startup, which is where a blocked event loop actually costs us the
 * whole service.
 *
 * Two properties matter and are covered by tests:
 *  - the main thread never blocks, however slow the query is;
 *  - the timeout measures *execution*, not time spent queued behind another
 *    query. `search_decision_text` fires two searches at once, so a
 *    dispatch-armed timer would cancel the second one for someone else's slowness.
 */
import { Worker } from "node:worker_threads";
import { resolveWorkerEntry } from "../../infra/worker-support.js";
export class QueryTimeoutError extends Error {
    constructor(label, timeoutMs) {
        super(`query "${label}" exceeded ${timeoutMs}ms and was cancelled`);
        this.name = "QueryTimeoutError";
    }
}
/** The worker cannot serve this query; the caller should fall back in-process. */
export class QueryWorkerUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = "QueryWorkerUnavailableError";
    }
}
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_POOL_SIZE = 2;
let enabled = false;
let timeoutMs = DEFAULT_TIMEOUT_MS;
let poolSize = DEFAULT_POOL_SIZE;
let dbPathProvider = null;
let pool = [];
let nextRequestId = 1;
const pending = new Map();
const waiting = [];
const stats = { served: 0, timedOut: 0, unavailable: 0 };
/**
 * Observability for the offload path. `unavailable > 0` means searches silently
 * ran in-process — the very thing the worker exists to avoid — so it is worth
 * surfacing rather than hiding.
 */
export function getQueryWorkerStats() {
    return { ...stats };
}
export function resetQueryWorkerStatsForTests() {
    stats.served = 0;
    stats.timedOut = 0;
    stats.unavailable = 0;
}
export function enableQueryWorker(options) {
    enabled = true;
    if (options?.timeoutMs !== undefined)
        timeoutMs = options.timeoutMs;
    if (options?.poolSize !== undefined)
        poolSize = Math.max(1, options.poolSize);
    if (options?.dbPath)
        dbPathProvider = options.dbPath;
}
export function disableQueryWorker() {
    enabled = false;
    timeoutMs = DEFAULT_TIMEOUT_MS;
    poolSize = DEFAULT_POOL_SIZE;
}
export function isQueryWorkerEnabled() {
    return enabled;
}
/** Test/shutdown helper: terminate every worker and fail anything still in flight. */
export async function shutdownQueryWorker() {
    const slots = pool;
    pool = [];
    rejectAllPending(new QueryWorkerUnavailableError("query worker was shut down"));
    await Promise.all(slots.map((slot) => slot.worker.terminate()));
}
function rejectAllPending(error) {
    for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(error);
    }
    pending.clear();
    waiting.length = 0;
}
/**
 * Drop a wedged worker. Its thread is stuck inside a synchronous SQLite call, so
 * terminating it is the only way to reclaim it.
 *
 * Caveat: terminate does not close the SQLite connection cleanly, so a killed
 * reader can leave a stale WAL read-mark behind and hold up checkpointing. That
 * is acceptable for rare cancellations — watch the `timedOut` counter; if it
 * climbs, the query needs fixing rather than cancelling.
 */
function discardSlot(slot) {
    pool = pool.filter((entry) => entry !== slot);
    void slot.worker.terminate();
    for (const [id, entry] of pending) {
        if (entry.slot !== slot)
            continue;
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.reject(new QueryWorkerUnavailableError("query worker was discarded mid-flight"));
    }
}
/**
 * Defaults to the store's own database path. Imported lazily to keep the store →
 * client → store cycle out of module evaluation order.
 */
async function resolveDbPath() {
    if (dbPathProvider)
        return dbPathProvider();
    const store = await import("./law-index-store.js");
    return store.getIndexDatabasePath();
}
async function spawnSlot() {
    const { url, options } = resolveWorkerEntry({
        callerUrl: import.meta.url,
        basename: "query-worker"
    });
    const worker = new Worker(url, {
        ...options,
        workerData: { dbPath: await resolveDbPath() }
    });
    worker.unref();
    const slot = { worker, busy: false };
    worker.on("message", (response) => {
        const entry = pending.get(response.id);
        if (!entry)
            return;
        // Execution started — restart the budget so queue time is not charged to it.
        if (response.ack) {
            clearTimeout(entry.timer);
            entry.timer = armTimer(response.id);
            return;
        }
        pending.delete(response.id);
        clearTimeout(entry.timer);
        slot.busy = false;
        if (response.ok) {
            stats.served += 1;
            entry.resolve(response.result);
        }
        else if (response.code === "QUERY_WORKER_DB_UNAVAILABLE") {
            stats.unavailable += 1;
            entry.reject(new QueryWorkerUnavailableError(response.error ?? "query worker database unavailable"));
        }
        else {
            entry.reject(new Error(response.error ?? "query worker failed"));
        }
        pump();
    });
    worker.on("error", (error) => {
        const message = error instanceof Error ? error.message : String(error);
        stats.unavailable += 1;
        discardSlot(slot);
        console.error(`[query-worker] thread failed: ${message}`);
    });
    worker.on("exit", () => {
        if (pool.includes(slot))
            discardSlot(slot);
    });
    pool.push(slot);
    return slot;
}
function armTimer(id) {
    const timer = setTimeout(() => {
        const entry = pending.get(id);
        if (!entry)
            return;
        pending.delete(id);
        stats.timedOut += 1;
        if (entry.slot) {
            discardSlot(entry.slot);
        }
        else {
            const queuedAt = waiting.indexOf(id);
            if (queuedAt !== -1)
                waiting.splice(queuedAt, 1);
        }
        entry.reject(new QueryTimeoutError(entry.label, timeoutMs));
        pump();
    }, timeoutMs);
    timer.unref?.();
    return timer;
}
/** Hand queued requests to idle workers, growing the pool up to its cap. */
function pump() {
    while (waiting.length > 0) {
        const idle = pool.find((slot) => !slot.busy);
        if (!idle) {
            if (pool.length < poolSize) {
                // Spawning is async; the new slot pumps itself once ready.
                void spawnSlot().then(() => pump());
            }
            return;
        }
        const id = waiting.shift();
        const entry = pending.get(id);
        if (!entry)
            continue;
        idle.busy = true;
        entry.slot = idle;
        idle.worker.postMessage({ id, ...entry.message });
    }
}
async function dispatch(label, message) {
    const id = nextRequestId;
    nextRequestId += 1;
    return await new Promise((resolve, reject) => {
        pending.set(id, {
            label,
            message,
            resolve: resolve,
            reject,
            timer: armTimer(id),
            slot: null
        });
        waiting.push(id);
        pump();
    });
}
/**
 * Run a read-only query on a worker thread. `sql` is built by the caller (see
 * fts-queries.ts) and parameters are bound, never interpolated; the worker holds
 * a read-only connection so it cannot mutate the index either way.
 */
export async function runReadQueryOnWorker(input) {
    return await dispatch(input.label, {
        kind: "query",
        sql: input.sql,
        params: input.params
    });
}
/** Test-only: occupy a worker thread so timeout and event-loop guarantees can be asserted. */
export async function spinOnWorkerForTests(ms) {
    return await dispatch("spin", { kind: "spin", ms });
}
//# sourceMappingURL=query-worker-client.js.map