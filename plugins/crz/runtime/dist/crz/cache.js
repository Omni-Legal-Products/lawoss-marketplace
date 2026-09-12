import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { LRUCache } from "lru-cache";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MEM = new LRUCache({ max: 1000 });
// Hard cap on the on-disk cache per namespace so the volume can't fill up
// (attachments are cached for 7 days as base64 JSON and can be large).
const CACHE_MAX_BYTES = Math.max(1, parseInt(process.env.CRZ_CACHE_MAX_MB ?? "1024", 10)) * 1024 * 1024;
// Check the directory size only every Nth write to keep cacheSet cheap.
const PRUNE_EVERY = 25;
const writeCounters = new Map();
/**
 * Given the files in a cache namespace, return the oldest files (by mtime) that
 * must be deleted to bring the total size at/under `capBytes`. Pure + testable.
 */
export function selectEvictions(entries, capBytes) {
    const total = entries.reduce((sum, e) => sum + e.size, 0);
    if (total <= capBytes)
        return [];
    const oldestFirst = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs);
    const toDelete = [];
    let running = total;
    for (const e of oldestFirst) {
        if (running <= capBytes)
            break;
        toDelete.push(e.file);
        running -= e.size;
    }
    return toDelete;
}
async function pruneNamespace(dir) {
    try {
        const names = await readdir(dir);
        const entries = [];
        for (const name of names) {
            const full = path.join(dir, name);
            try {
                const st = await stat(full);
                if (st.isFile())
                    entries.push({ file: full, size: st.size, mtimeMs: st.mtimeMs });
            }
            catch { /* file vanished; ignore */ }
        }
        for (const file of selectEvictions(entries, CACHE_MAX_BYTES)) {
            try {
                await unlink(file);
            }
            catch { /* best-effort */ }
        }
    }
    catch { /* best-effort cleanup */ }
}
function maybePrune(namespace, dir) {
    const n = (writeCounters.get(namespace) ?? 0) + 1;
    writeCounters.set(namespace, n);
    if (n % PRUNE_EVERY !== 0)
        return;
    // Fire-and-forget; pruning must never block or fail a cache write.
    void pruneNamespace(dir);
}
function diskDir() {
    const dir = process.env.CRZ_CACHE_DIR;
    if (!dir)
        return null;
    return dir;
}
function key(s) {
    return createHash("sha256").update(s).digest("hex");
}
async function ensureDir(dir) {
    try {
        await mkdir(dir, { recursive: true });
        return true;
    }
    catch {
        return false;
    }
}
export async function cacheGet(namespace, k, ttlMs) {
    const fullKey = `${namespace}:${k}`;
    const mem = MEM.get(fullKey);
    if (mem && mem.exp > Date.now())
        return mem.v;
    const dir = diskDir();
    if (!dir)
        return undefined;
    const filePath = path.join(dir, namespace, key(k) + ".json");
    try {
        const st = await stat(filePath);
        if (Date.now() - st.mtimeMs > ttlMs)
            return undefined;
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        MEM.set(fullKey, { v: parsed.v, exp: Date.now() + ttlMs });
        return parsed.v;
    }
    catch {
        return undefined;
    }
}
export async function cacheSet(namespace, k, value, ttlMs) {
    const fullKey = `${namespace}:${k}`;
    MEM.set(fullKey, { v: value, exp: Date.now() + ttlMs });
    const dir = diskDir();
    if (!dir)
        return;
    const ns = path.join(dir, namespace);
    if (!(await ensureDir(ns)))
        return;
    const filePath = path.join(ns, key(k) + ".json");
    try {
        await writeFile(filePath, JSON.stringify({ v: value }), "utf8");
        maybePrune(namespace, ns);
    }
    catch {
        // disk cache is best-effort
    }
}
export const TTL = {
    CONTRACT_MS: 24 * 60 * 60 * 1000,
    SEARCH_MS: 5 * 60 * 1000,
    ATTACHMENT_MS: 7 * 24 * 60 * 60 * 1000,
};
//# sourceMappingURL=cache.js.map