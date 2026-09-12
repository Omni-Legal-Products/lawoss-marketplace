import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { CRZ_BASE_URL, httpGet } from "./client.js";
import { cacheGet, cacheSet, TTL } from "./cache.js";
import { getContract } from "./contract.js";
const MAX_ATTACHMENT_MB = parseInt(process.env.CRZ_MAX_ATTACHMENT_MB ?? "25", 10);
const MAX_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;
const EXTS_TO_TRY = ["pdf", "docx", "doc", "rtf", "txt", "xlsx", "xls", "zip"];
// Cache namespace mapping an attachment file_id -> its known extension, populated
// whenever a contract page is parsed. Lets downloads skip blind 404 probing.
const EXT_NS = "attext";
/**
 * Build the ordered list of extensions to try when downloading an attachment.
 * An explicit `ext` is authoritative. Otherwise a `knownExt` (from the parsed
 * contract metadata) is tried first, then the common defaults — without dupes.
 */
export function resolveAttemptOrder(ext, knownExt) {
    const norm = (e) => e.toLowerCase().replace(/^\./, "");
    if (ext)
        return [norm(ext)];
    const order = [];
    if (knownExt)
        order.push(norm(knownExt));
    for (const e of EXTS_TO_TRY) {
        if (!order.includes(e))
            order.push(e);
    }
    return order;
}
/** Record a file_id -> extension hint so future downloads avoid probing. */
export async function rememberAttachmentExt(file_id, ext) {
    await cacheSet(EXT_NS, String(file_id), ext.toLowerCase().replace(/^\./, ""), TTL.CONTRACT_MS);
}
export async function listAttachments(contractId) {
    const c = await getContract(contractId);
    return c.attachments;
}
export async function downloadAttachment(file_id, ext) {
    const id = String(file_id).trim();
    if (!/^\d+$/.test(id))
        throw new Error(`Invalid attachment file_id: ${id}`);
    const knownExt = ext ? undefined : await cacheGet(EXT_NS, id, TTL.CONTRACT_MS);
    const attemptOrder = resolveAttemptOrder(ext, knownExt);
    let lastErr;
    for (const e of attemptOrder) {
        const url = `${CRZ_BASE_URL}/data/att/${id}.${e}`;
        const cached = await cacheGet("att", `${id}.${e}`, TTL.ATTACHMENT_MS);
        if (cached) {
            return {
                file_id: id,
                ext: cached.ext,
                mime: cached.mime,
                bytes: cached.bytes,
                buffer: Buffer.from(cached.buffer_b64, "base64"),
                url,
            };
        }
        try {
            const res = await httpGet(url, { acceptBinary: true, maxBytes: MAX_BYTES });
            if (res.status === 404)
                continue;
            if (res.status >= 400) {
                lastErr = new Error(`CRZ attachment ${url} returned ${res.status}`);
                continue;
            }
            const ct = res.headers.get("content-type") ?? "";
            const buffer = Buffer.from(res.body);
            const mime = ct.split(";")[0].trim() || extToMime(e);
            const out = {
                file_id: id,
                ext: e,
                mime,
                bytes: buffer.byteLength,
                buffer,
                url,
            };
            await cacheSet("att", `${id}.${e}`, {
                buffer_b64: buffer.toString("base64"),
                ext: e,
                mime,
                bytes: buffer.byteLength,
            }, TTL.ATTACHMENT_MS);
            return out;
        }
        catch (err) {
            lastErr = err;
        }
    }
    throw lastErr ?? new Error(`Attachment ${id} not found with extensions ${attemptOrder.join(", ")}`);
}
export async function saveAttachmentToPath(file_id, savePath, ext) {
    const dl = await downloadAttachment(file_id, ext);
    let target = savePath;
    if (target.endsWith("/") || target.endsWith(path.sep)) {
        target = path.join(target, `${dl.file_id}.${dl.ext}`);
    }
    await mkdir(path.dirname(path.resolve(target)), { recursive: true });
    await writeFile(target, dl.buffer);
    return { path: path.resolve(target), bytes: dl.bytes, mime: dl.mime, ext: dl.ext };
}
function extToMime(ext) {
    const e = ext.toLowerCase();
    if (e === "pdf")
        return "application/pdf";
    if (e === "docx")
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (e === "doc")
        return "application/msword";
    if (e === "rtf")
        return "application/rtf";
    if (e === "txt")
        return "text/plain";
    if (e === "xlsx")
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (e === "xls")
        return "application/vnd.ms-excel";
    if (e === "zip")
        return "application/zip";
    return "application/octet-stream";
}
//# sourceMappingURL=attachments.js.map