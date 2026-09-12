import { readdir, stat } from "node:fs/promises";
import path from "node:path";
async function walk(dir, onFile) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return; // missing dir
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await walk(full, onFile);
        }
        else if (entry.isFile()) {
            try {
                const s = await stat(full);
                onFile(full, s.size);
            }
            catch {
                // ignore vanished files
            }
        }
    }
}
/** Sizes under .cache/judiciary: total, the SQLite DB (+ wal/shm), and downloaded PDFs. */
export async function collectCacheDiskUsage() {
    const root = path.resolve(process.cwd(), ".cache", "judiciary");
    let dbBytes = 0;
    let documentsBytes = 0;
    let totalBytes = 0;
    await walk(root, (filePath, size) => {
        totalBytes += size;
        const base = path.basename(filePath);
        if (base.startsWith("index.sqlite"))
            dbBytes += size;
        if (filePath.split(path.sep).includes("documents"))
            documentsBytes += size;
    });
    return { dbBytes, documentsBytes, totalBytes };
}
//# sourceMappingURL=disk-usage.js.map