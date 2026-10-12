import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getJudiciaryDataDir } from "./data-dir.js";
const execFile = promisify(execFileCallback);
const DEFAULT_PDFTOTEXT_CANDIDATES = [
    process.env.PDFTOTEXT_BIN,
    "pdftotext",
    "/opt/homebrew/bin/pdftotext",
    "/usr/local/bin/pdftotext",
    "/usr/bin/pdftotext"
].filter((value) => Boolean(value));
export async function downloadPdfToCache(input) {
    const cacheDir = path.join(getJudiciaryDataDir(), input.provider, "documents");
    await mkdir(cacheDir, { recursive: true });
    const safeName = sanitizeFileName(input.preferredFileName ?? "decision.pdf");
    const hashedPrefix = createHash("sha256").update(input.url).digest("hex").slice(0, 16);
    const savedPath = path.join(cacheDir, `${hashedPrefix}-${safeName}`);
    try {
        await access(savedPath);
        const buffer = await readFile(savedPath);
        return {
            savedPath,
            sizeBytes: buffer.byteLength
        };
    }
    catch {
        // Cache miss; continue with download.
    }
    const response = await fetch(input.url);
    if (!response.ok) {
        throw new Error(`Failed to download PDF: HTTP ${response.status} for ${input.url}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(savedPath, buffer);
    return {
        savedPath,
        sizeBytes: buffer.byteLength
    };
}
export async function extractPdfText(filePath) {
    let lastError;
    for (const binary of getPdftotextCandidates()) {
        try {
            const { stdout } = await execFile(binary, ["-enc", "UTF-8", filePath, "-"], {
                maxBuffer: 50 * 1024 * 1024
            });
            return stdout;
        }
        catch (error) {
            lastError = error;
            if (!isMissingBinaryError(error)) {
                throw error;
            }
        }
    }
    throw new Error(`pdftotext binary was not found. Install Poppler or set PDFTOTEXT_BIN. Last error: ${String(lastError)}`);
}
/** Best-effort removal of a cached PDF after its text has been extracted. Never throws. */
export async function removeCachedPdf(filePath) {
    try {
        await rm(filePath, { force: true });
    }
    catch {
        // ignore — cache hygiene only
    }
}
export function buildTextWindow(input) {
    const normalizedText = input.sourceMode === "pdf_extract" ? normalizePdfExtractedText(input.text) : input.text;
    return sliceTextWindow({ ...input, text: normalizedText });
}
/**
 * The windowing half of `buildTextWindow`, without the PDF normalization pass.
 * Text that has already been through `buildTextWindow` — anything read back out
 * of `provider_texts` — must not be normalized a second time.
 */
export function sliceTextWindow(input) {
    const windowText = input.text.slice(input.offsetChars, input.offsetChars + input.maxChars);
    const nextOffset = input.offsetChars + input.maxChars;
    return {
        provider: input.provider,
        id: input.id,
        text: windowText,
        windowComplete: nextOffset >= input.text.length,
        nextOffset: nextOffset >= input.text.length ? null : nextOffset,
        sourceMode: input.sourceMode,
        textSha256: createHash("sha256").update(input.text).digest("hex")
    };
}
export function getPdftotextCandidates() {
    return [...new Set(DEFAULT_PDFTOTEXT_CANDIDATES)];
}
// A court register token (C, Co, Cdo, Obdo, Sžo, CoCsp ...): uppercase initial, at most five letters.
// Anything longer or lowercase-initial is an ordinary word ("nariadenia", "smernice"), not a register.
const REGISTER = "\\p{Lu}\\p{L}{0,4}";
const COURT_YEAR = "(?:19|20)\\d{2}";
export function normalizePdfExtractedText(text) {
    return text
        .replace(new RegExp(`\\b(\\d{1,3})\\s+(${REGISTER})\\s+(\\d{1,5})\\/(${COURT_YEAR})\\b`, "gu"), "$1$2/$3/$4")
        .replace(new RegExp(`\\b([IVXLC]+\\.)\\s+(${REGISTER})\\s+(\\d{1,5})\\/(${COURT_YEAR})\\b`, "gu"), "$1 $2 $3/$4")
        .replace(new RegExp(`\\b((?:\\d{1,3}${REGISTER}|[IVXLC]+\\.\\s*${REGISTER})\\/)(\\d{1,4})(${COURT_YEAR})\\b`, "gu"), "$1$2/$3");
}
function sanitizeFileName(name) {
    const trimmed = name.trim() || "decision.pdf";
    return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
function isMissingBinaryError(error) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT");
}
//# sourceMappingURL=pdf.js.map