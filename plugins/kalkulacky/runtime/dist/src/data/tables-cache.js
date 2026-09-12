// Reload-aware wrapper around loadTables(). The weekly refresh cron
// (scripts/refresh-rates.ts, run via `npm run refresh:rates:prod`) writes
// fresh overlay JSON into DATA_OVERLAY_DIR — a docker volume the running
// server process shares but does not itself watch. Without this module a
// server captured `loadTables()`'s result once at startup and never saw the
// refresh until the container restarted, making the weekly schedule a no-op.
//
// getTables() caches the loaded Tables and re-runs loadTables() only when
// the newest mtime among the watched data files is newer than what produced
// the cached snapshot — and even that mtime check is throttled to at most
// once per STAT_INTERVAL_MS, so normal tool calls pay no extra fs cost.
//
// A reload attempt NEVER throws out of getTables(): if the newly-written
// files are mid-write or corrupt, loadTables() throws, we log a warning and
// keep serving the last good snapshot. Partial/half-loaded state is never
// exposed — cached is only replaced after loadTables() returns fully.
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTables, resolveDefaultRepoDir, DATA_FILE_NAMES } from "./loader.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
/** Minimum time between fs.stat sweeps, in ms. Bounds the hot-path fs cost. */
export const STAT_INTERVAL_MS = 60_000;
/**
 * Same file set loadTables() reads — derived from src/data/loader.ts's
 * `DATA_FILE_NAMES` (itself derived from the loader's `specs`), so a future
 * 7th data file is watched automatically instead of needing a second,
 * hand-kept copy of the filename list here.
 */
export const WATCHED_FILES = DATA_FILE_NAMES;
/**
 * Best-effort mtime sweep. Uses `throwIfNoEntry: false` (never `existsSync` +
 * `statSync`) so a file that disappears or errors between the two calls
 * (TOCTOU — e.g. the refresh script mid-rewrite) can't throw out of here:
 * a missing/unreadable file is simply skipped, not an error.
 */
function newestMtimeMs(dir) {
    if (!dir)
        return 0;
    let newest = 0;
    for (const file of WATCHED_FILES) {
        const path = join(dir, file);
        let mtimeMs;
        try {
            const st = statSync(path, { throwIfNoEntry: false });
            if (!st)
                continue;
            mtimeMs = st.mtimeMs;
        }
        catch {
            continue; // treat any stat failure as "no signal from this file"
        }
        if (mtimeMs > newest)
            newest = mtimeMs;
    }
    return newest;
}
export function createTablesCache(deps) {
    let cached = null;
    let cachedMtimeMs = 0;
    let lastStatAt = -Infinity;
    function getTables() {
        const now = deps.now();
        if (cached !== null && now - lastStatAt < deps.statIntervalMs) {
            return cached;
        }
        lastStatAt = now;
        const mtimeMs = newestMtimeMs(deps.watchDir());
        if (cached !== null && mtimeMs <= cachedMtimeMs) {
            return cached;
        }
        try {
            const fresh = deps.load();
            cached = fresh;
            cachedMtimeMs = mtimeMs;
            return cached;
        }
        catch (err) {
            if (cached !== null) {
                deps.warn(`[data/tables-cache] reload failed, naďalej sa servíruje posledný platný snapshot: ${err.message}`);
                return cached;
            }
            throw err; // no good snapshot to fall back on — first load must succeed
        }
    }
    return { getTables };
}
function defaultWatchDir() {
    const overlay = process.env["DATA_OVERLAY_DIR"];
    if (overlay)
        return overlay;
    try {
        return resolveDefaultRepoDir(__dirname);
    }
    catch {
        return null;
    }
}
const defaultCache = createTablesCache({
    load: () => loadTables(),
    now: () => Date.now(),
    watchDir: defaultWatchDir,
    warn: (message) => console.warn(message),
    statIntervalMs: STAT_INTERVAL_MS,
});
/** Process-wide cached table provider — reloads on overlay/repo change, see module docstring. */
export function getTables() {
    return defaultCache.getTables();
}
//# sourceMappingURL=tables-cache.js.map