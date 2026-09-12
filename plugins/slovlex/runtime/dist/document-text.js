import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { LRUCache } from "lru-cache";
function normalizeExtractedText(text) {
    return text
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
const extractedTextCache = new LRUCache({ max: 128, ttl: 1000 * 60 * 60 });
const extractedTextInFlight = new Map();
export async function getCachedDocumentText(key, loader) {
    const cached = extractedTextCache.get(key);
    if (cached)
        return cached;
    const inFlight = extractedTextInFlight.get(key);
    if (inFlight)
        return inFlight;
    const loading = (async () => {
        const extracted = await loader();
        extractedTextCache.set(key, extracted);
        return extracted;
    })();
    extractedTextInFlight.set(key, loading);
    void loading.finally(() => {
        if (extractedTextInFlight.get(key) === loading)
            extractedTextInFlight.delete(key);
    }).catch(() => undefined);
    return loading;
}
function detectFormat(fileName, contentType) {
    const name = (fileName ?? "").toLowerCase();
    const ctype = (contentType ?? "").toLowerCase();
    if (name.endsWith(".pdf") || ctype.includes("application/pdf"))
        return "pdf";
    if (name.endsWith(".docx") ||
        ctype.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
        return "docx";
    }
    return "unknown";
}
export async function extractTextFromDocument(bytes, options = {}) {
    const format = detectFormat(options.fileName, options.contentType);
    const buffer = Buffer.from(bytes);
    if (format === "docx") {
        const result = await mammoth.extractRawText({ buffer });
        return { text: normalizeExtractedText(result.value), format };
    }
    if (format === "pdf") {
        const parser = new PDFParse({ data: buffer });
        try {
            const result = await parser.getText();
            return { text: normalizeExtractedText(result.text), format };
        }
        finally {
            await parser.destroy();
        }
    }
    // Fallback: try docx first, then pdf.
    try {
        const docx = await mammoth.extractRawText({ buffer });
        const text = normalizeExtractedText(docx.value);
        if (text)
            return { text, format: "docx" };
    }
    catch {
        // ignore
    }
    try {
        const parser = new PDFParse({ data: buffer });
        try {
            const pdf = await parser.getText();
            const text = normalizeExtractedText(pdf.text);
            if (text)
                return { text, format: "pdf" };
        }
        finally {
            await parser.destroy();
        }
    }
    catch {
        // ignore
    }
    throw new Error("Nepodarilo sa zistiť formát dokumentu (očakávam PDF alebo DOCX).");
}
