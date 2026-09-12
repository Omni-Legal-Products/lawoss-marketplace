import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import * as mammothNs from "mammoth";
const mammoth = mammothNs;
import { getContract } from "./contract.js";
import { downloadAttachment } from "./attachments.js";
let pdfParseFn;
const MIN_USEFUL_PDF_TEXT_CHARS = parseInt(process.env.CRZ_MIN_PDF_TEXT_CHARS ?? "200", 10);
const MISTRAL_OCR_MODEL = process.env.MISTRAL_OCR_MODEL ?? "mistral-ocr-latest";
const MISTRAL_OCR_TIMEOUT_MS = parseInt(process.env.MISTRAL_OCR_TIMEOUT_MS ?? "180000", 10);
const MISTRAL_OCR_ENABLED = process.env.CRZ_MISTRAL_OCR !== "0";
async function getPdfParser() {
    if (pdfParseFn !== undefined)
        return pdfParseFn;
    try {
        const mod = await import("pdf-parse");
        const legacyParser = mod.default;
        if (typeof legacyParser === "function") {
            pdfParseFn = legacyParser;
        }
        else if (typeof mod.PDFParse === "function") {
            const { PDFParse } = mod;
            pdfParseFn = async (data) => {
                const parser = new PDFParse({ data });
                try {
                    const result = await parser.getText();
                    return { text: result.text ?? "", numpages: result.total };
                }
                finally {
                    await parser.destroy();
                }
            };
        }
        else {
            pdfParseFn = null;
        }
    }
    catch {
        pdfParseFn = null;
    }
    return pdfParseFn;
}
function normalizeText(s) {
    return s
        .replace(/\r\n?/g, "\n")
        .replace(/ /g, " ")
        .replace(/\f/g, "\n\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
function usefulTextLength(markdown) {
    return markdown.replace(/\s/g, "").length;
}
function inlineMistralTables(markdown, tables = []) {
    let output = markdown;
    for (const table of tables) {
        const tableMarkdown = normalizeText(table.markdown ?? "");
        if (tableMarkdown && !output.includes(tableMarkdown)) {
            output += `\n\n${tableMarkdown}`;
        }
    }
    return output;
}
async function mistralPdfToMarkdown(buf) {
    const warnings = [];
    if (!MISTRAL_OCR_ENABLED) {
        warnings.push("mistral_ocr_disabled");
        return { markdown: "", warnings };
    }
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
        warnings.push("mistral_ocr_unavailable: missing_mistral_api_key");
        return { markdown: "", warnings };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MISTRAL_OCR_TIMEOUT_MS);
    try {
        const response = await fetch("https://api.mistral.ai/v1/ocr", {
            method: "POST",
            signal: controller.signal,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: MISTRAL_OCR_MODEL,
                document: {
                    type: "document_url",
                    document_url: `data:application/pdf;base64,${buf.toString("base64")}`,
                },
                include_image_base64: false,
                image_limit: 0,
                extract_header: true,
                extract_footer: true,
                table_format: "markdown",
            }),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            warnings.push(`mistral_ocr_failed: http_${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`);
            return { markdown: "", warnings };
        }
        const data = await response.json();
        const markdown = normalizeText((data.pages ?? [])
            .map((page) => inlineMistralTables(page.markdown ?? "", page.tables))
            .filter((page) => page.trim().length > 0)
            .join("\n\n"));
        if (!markdown)
            warnings.push("mistral_ocr_empty_result");
        return { markdown, warnings };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`mistral_ocr_failed: ${msg}`);
        return { markdown: "", warnings };
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function pdfToMarkdown(buf) {
    const warnings = [];
    const parser = await getPdfParser();
    if (!parser) {
        warnings.push("pdf-parse unavailable; cannot extract PDF text");
        const ocr = await mistralPdfToMarkdown(buf);
        if (ocr.markdown)
            warnings.push("mistral_ocr_used");
        warnings.push(...ocr.warnings);
        return { markdown: ocr.markdown, warnings };
    }
    try {
        const result = await parser(buf);
        const text = normalizeText(result.text ?? "");
        if (usefulTextLength(text) >= MIN_USEFUL_PDF_TEXT_CHARS) {
            return { markdown: text, pages: result.numpages, warnings };
        }
        warnings.push(text ? "pdf_text_layer_too_short; trying Mistral OCR" : "pdf_text_layer_empty (likely scanned image); trying Mistral OCR");
        const ocr = await mistralPdfToMarkdown(buf);
        if (ocr.markdown)
            warnings.push("mistral_ocr_used");
        warnings.push(...ocr.warnings);
        return { markdown: ocr.markdown || text, pages: result.numpages, warnings };
    }
    catch (err) {
        warnings.push(`pdf_parse_failed: ${err.message}`);
        const ocr = await mistralPdfToMarkdown(buf);
        if (ocr.markdown)
            warnings.push("mistral_ocr_used");
        warnings.push(...ocr.warnings);
        return { markdown: ocr.markdown, warnings };
    }
}
export async function docxToMarkdown(buf) {
    const warnings = [];
    try {
        const result = await mammoth.convertToMarkdown({ buffer: buf });
        if (result.messages?.length) {
            for (const m of result.messages)
                warnings.push(`docx:${m.type}:${m.message}`);
        }
        return { markdown: normalizeText(result.value), warnings };
    }
    catch (err) {
        warnings.push(`docx_parse_failed: ${err.message}`);
        return { markdown: "", warnings };
    }
}
export async function attachmentToMarkdown(att) {
    const e = att.ext.toLowerCase();
    if (e === "pdf") {
        const r = await pdfToMarkdown(att.buffer);
        return { markdown: r.markdown, warnings: r.warnings };
    }
    if (e === "docx")
        return docxToMarkdown(att.buffer);
    if (e === "txt")
        return { markdown: normalizeText(att.buffer.toString("utf8")), warnings: [] };
    // For unsupported types we still emit a stub.
    return { markdown: "", warnings: [`unsupported_attachment_type:${e}`] };
}
function metadataAsMarkdown(c) {
    const lines = [];
    const title = c.nazov ?? c.cislo_zmluvy ?? `Zmluva ${c.id}`;
    lines.push(`# ${title}`);
    lines.push("");
    lines.push(`> CRZ ID: **${c.id}** — [${c.url}](${c.url})`);
    lines.push("");
    lines.push("## Identifikácia zmluvy");
    const id = [
        ["Typ", c.typ],
        ["Číslo zmluvy", c.cislo_zmluvy],
        ["Názov zmluvy", c.nazov],
        ["Predmet", c.predmet],
        ["Rezort", c.rezort],
        ["Zverejnil", c.zverejnil],
    ];
    for (const [k, v] of id)
        if (v)
            lines.push(`- **${k}:** ${v}`);
    if (c.objednavatel) {
        lines.push("");
        lines.push("### Objednávateľ");
        lines.push(`- **Názov:** ${c.objednavatel.name}`);
        if (c.objednavatel.address)
            lines.push(`- **Adresa:** ${c.objednavatel.address}`);
        if (c.objednavatel.ico)
            lines.push(`- **IČO:** ${c.objednavatel.ico}`);
    }
    if (c.dodavatel) {
        lines.push("");
        lines.push("### Dodávateľ");
        lines.push(`- **Názov:** ${c.dodavatel.name}`);
        if (c.dodavatel.address)
            lines.push(`- **Adresa:** ${c.dodavatel.address}`);
        if (c.dodavatel.ico)
            lines.push(`- **IČO:** ${c.dodavatel.ico}`);
    }
    lines.push("");
    lines.push("## Dátumy");
    const dt = [
        ["Zverejnenie", c.datum_zverejnenia],
        ["Uzavretie", c.datum_uzavretia],
        ["Účinnosť", c.datum_ucinnosti],
        ["Platnosť do", c.datum_platnosti_do],
    ];
    for (const [k, v] of dt)
        if (v)
            lines.push(`- **${k}:** ${v}`);
    if (c.cena) {
        lines.push("");
        lines.push("## Cenové plnenie");
        if (c.cena.zmluvne_dohodnuta)
            lines.push(`- **Zmluvne dohodnutá čiastka:** ${c.cena.zmluvne_dohodnuta}`);
        if (c.cena.celkova)
            lines.push(`- **Celková čiastka:** ${c.cena.celkova}`);
    }
    if (c.attachments.length) {
        lines.push("");
        lines.push("## Prílohy");
        for (const a of c.attachments) {
            const size = a.size_kb ? ` (${a.size_kb.toFixed(2)} kB)` : "";
            lines.push(`- [${a.name}](${a.url}) — \`${a.ext}\`${size}`);
        }
    }
    if (c.warnings.length) {
        lines.push("");
        lines.push("> Parser warnings: " + c.warnings.join(", "));
    }
    return lines.join("\n");
}
const ATTACHMENT_CONCURRENCY = Math.max(1, parseInt(process.env.CRZ_ATTACHMENT_CONCURRENCY ?? "3", 10));
/**
 * Map `items` through `fn` with at most `limit` running concurrently, preserving
 * input order in the result. Used to overlap attachment downloads/OCR.
 */
export async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const i = next++;
            if (i >= items.length)
                return;
            results[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return results;
}
export async function contractToMarkdown(id, opts = {}) {
    const includeAttachments = opts.include_attachments !== false;
    const contract = await getContract(id);
    const metaMd = metadataAsMarkdown(contract);
    let entries = [];
    if (includeAttachments) {
        entries = await mapWithConcurrency(contract.attachments, ATTACHMENT_CONCURRENCY, async (a) => {
            try {
                const dl = await downloadAttachment(a.file_id, a.ext);
                const converted = await attachmentToMarkdown({ ext: dl.ext, buffer: dl.buffer, name: a.name });
                return {
                    file_id: a.file_id,
                    name: a.name,
                    ext: dl.ext,
                    source_url: a.url,
                    markdown: converted.markdown,
                    bytes: dl.bytes,
                    warnings: converted.warnings,
                };
            }
            catch (err) {
                return {
                    file_id: a.file_id,
                    name: a.name,
                    ext: a.ext,
                    source_url: a.url,
                    markdown: "",
                    bytes: 0,
                    warnings: [`download_failed: ${err.message}`],
                };
            }
        });
    }
    const sectionBlocks = entries.map((e) => {
        const w = e.warnings.length ? `\n\n> Warnings: ${e.warnings.join(", ")}` : "";
        const body = e.markdown.trim() ? e.markdown : "_(no text extracted — likely scanned image; download the original from the link below)_";
        return `\n\n---\n\n## Príloha: ${e.name}\n\n> Zdroj: [${e.source_url}](${e.source_url}) — \`${e.ext}\`, ${e.bytes} B${w}\n\n${body}`;
    });
    const full = metaMd + sectionBlocks.join("");
    let savedDir;
    if (opts.save_to_dir) {
        const dir = path.resolve(opts.save_to_dir);
        await mkdir(dir, { recursive: true });
        const metaPath = path.join(dir, `${contract.id}.md`);
        await writeFile(metaPath, full, "utf8");
        for (const e of entries) {
            if (e.markdown) {
                const p = path.join(dir, `${contract.id}_att_${e.file_id}.md`);
                await writeFile(p, e.markdown, "utf8");
                e.saved_path = p;
            }
        }
        savedDir = dir;
    }
    return {
        id: contract.id,
        metadata: contract,
        metadata_markdown: metaMd,
        full_markdown: full,
        attachments: entries,
        saved_dir: savedDir,
    };
}
// Useful helper for the `crz_summarize_contract` tool.
export function summarizeContract(c) {
    const parties = [
        c.objednavatel ? `Objednávateľ: ${c.objednavatel.name}${c.objednavatel.ico ? ` (IČO ${c.objednavatel.ico})` : ""}` : null,
        c.dodavatel ? `Dodávateľ: ${c.dodavatel.name}${c.dodavatel.ico ? ` (IČO ${c.dodavatel.ico})` : ""}` : null,
    ].filter(Boolean).join("; ");
    const dates = [
        c.datum_uzavretia ? `uzavretá ${c.datum_uzavretia}` : null,
        c.datum_ucinnosti ? `účinná od ${c.datum_ucinnosti}` : null,
        c.datum_platnosti_do ? `platnosť do ${c.datum_platnosti_do}` : null,
    ].filter(Boolean).join(", ");
    const cena = c.cena?.celkova ?? c.cena?.zmluvne_dohodnuta ?? "neuvedená";
    const title = c.nazov ?? c.cislo_zmluvy ?? `Zmluva ${c.id}`;
    const cislo = c.cislo_zmluvy ? ` (č. ${c.cislo_zmluvy})` : "";
    return `${title}${cislo}. ${parties}. ${dates ? dates + ". " : ""}Cena: ${cena}. ${c.rezort ? `Rezort: ${c.rezort}. ` : ""}Zdroj: ${c.url}`.trim();
}
//# sourceMappingURL=markdown.js.map