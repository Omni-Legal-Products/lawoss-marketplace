import { z } from "zod";
import { normalizeCelex } from "./celex-parser.js";
import { getDocumentContent, exportDocument, getAvailableLanguages, getDocumentVersions, compareDocuments, findInDocument, } from "./eurlex-client.js";
import { SUPPORTED_LANGUAGES, CHARACTER_LIMIT } from "./constants.js";
const langSchema = z.enum([...SUPPORTED_LANGUAGES]).default("en").describe("ISO 639-1 language code (e.g., 'sk', 'en', 'de'). Default: 'en'");
export function registerDocumentTools(server) {
    // ── eurlex_document_get ─────────────────────────────────────────────────
    server.registerTool("eurlex_document_get", {
        title: "Get Document Content as Markdown",
        description: `Retrieve the full text of an EU legal document as Markdown, converted from the official HTML.

Supports windowed reading for large documents (regulations like GDPR or REACH can be 100k+ characters). Use offset_chars and max_chars to page through the document.

Args:
  - celex (string): CELEX number (e.g., "32016R0679")
  - lang (string): ISO 639-1 language code — "sk", "en", "de", etc. (default: "en")
  - offset_chars (number): Start reading from this character offset (default: 0)
  - max_chars (number): Maximum characters to return in one call (default: 8000, max: 40000)
  - response_format ("markdown" | "json"): Output format (default: "markdown")

Returns:
  Text content of the document in Markdown format, plus metadata:
  - MCP_WINDOW_COMPLETE: whether end of document was reached
  - MCP_TOTAL_CHARS: total length of the document
  - MCP_NEXT_OFFSET: offset for next page (if not complete)
  - language: language of the returned content

Windowing example (reading GDPR in Slovak):
  1. eurlex_document_get("32016R0679", lang="sk") → first 8000 chars, MCP_NEXT_OFFSET: 8000
  2. eurlex_document_get("32016R0679", lang="sk", offset_chars=8000) → next window
  ... repeat until MCP_WINDOW_COMPLETE: true

Errors:
  - "Failed to fetch document" if CELEX not found or language not available
  - Use eurlex_document_languages first to check available languages`,
        inputSchema: z.object({
            celex: z.string().min(6).describe("CELEX number (e.g., '32016R0679')"),
            lang: langSchema,
            offset_chars: z.number().int().min(0).default(0).describe("Start offset in characters (default: 0)"),
            max_chars: z.number().int().min(100).max(CHARACTER_LIMIT).default(8000).describe(`Max characters to return (default: 8000, max: ${CHARACTER_LIMIT})`),
            response_format: z.enum(["markdown", "json"]).default("markdown"),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ celex, lang, offset_chars, max_chars, response_format }) => {
        const result = await getDocumentContent(celex, lang, offset_chars, max_chars).catch(err => { throw new Error(err.message); });
        if (response_format === "json") {
            return {
                content: [{ type: "text", text: JSON.stringify({
                            celex: normalizeCelex(celex),
                            language: result.language,
                            content: result.content,
                            totalChars: result.totalChars,
                            complete: result.complete,
                            nextOffset: result.nextOffset,
                        }, null, 2) }],
            };
        }
        const header = [
            `## Document: ${normalizeCelex(celex)} (${lang.toUpperCase()})`,
            `*Window: chars ${offset_chars}–${offset_chars + result.content.length} of ${result.totalChars}*`,
            `*MCP_WINDOW_COMPLETE: ${result.complete}*`,
            result.nextOffset !== undefined ? `*MCP_NEXT_OFFSET: ${result.nextOffset}*` : "",
            "",
        ].filter(Boolean).join("\n");
        return {
            content: [{ type: "text", text: header + result.content }],
        };
    });
    // ── eurlex_document_export ──────────────────────────────────────────────
    server.registerTool("eurlex_document_export", {
        title: "Export Document to PDF, HTML, or XML",
        description: `Download and save an EU legal document to the local exports directory.

Use this to obtain the official document for archiving, attaching to legal submissions, or offline review. The file is saved to the configured EXPORT_DIR.

Args:
  - celex (string): CELEX number (e.g., "32016R0679")
  - lang (string): Language code (e.g., "sk", "en", "de") (default: "en")
  - format ("pdf" | "html" | "xml"): Output format (default: "pdf")

Returns:
  - filePath: absolute path to the saved file
  - format: the saved format
  - sizeBytes: file size in bytes
  - celexNumber: normalized CELEX number

Examples:
  - Export GDPR in Slovak as PDF: celex="32016R0679", lang="sk", format="pdf"
  - Export Directive in German as HTML: celex="32000L0060", lang="de", format="html"

Notes:
  - PDF is recommended for official submissions
  - Not all documents are available in all languages or formats
  - Large documents (>100 pages) may take up to 60 seconds

Errors:
  - "Failed to export document" if format/language not available for this document`,
        inputSchema: z.object({
            celex: z.string().min(6).describe("CELEX number (e.g., '32016R0679')"),
            lang: langSchema,
            format: z.enum(["pdf", "html", "xml"]).default("pdf").describe("Export format (default: 'pdf')"),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ celex, lang, format }) => {
        const result = await exportDocument(celex, lang, format).catch(err => { throw new Error(err.message); });
        const sizeKB = (result.sizeBytes / 1024).toFixed(1);
        const text = [
            `## ✅ Document Exported Successfully`,
            "",
            `**CELEX:** ${result.celexNumber}`,
            `**Language:** ${result.language.toUpperCase()}`,
            `**Format:** ${result.format.toUpperCase()}`,
            `**File:** \`${result.filePath}\``,
            `**Size:** ${sizeKB} KB`,
        ].join("\n");
        return {
            content: [{ type: "text", text }],
            structuredContent: result,
        };
    });
    // ── eurlex_document_languages ───────────────────────────────────────────
    server.registerTool("eurlex_document_languages", {
        title: "List Available Languages for a Document",
        description: `Get the list of language versions available for an EU legal document in EUR-Lex.

Not all documents are available in all 24 EU official languages. Use this before requesting a specific language with eurlex_document_get or eurlex_document_export.

Args:
  - celex (string): CELEX number (e.g., "32016R0679")

Returns:
  - availableLanguages: array of ISO 639-1 language codes (e.g., ["bg", "cs", "da", "de", "en", "sk", ...])
  - count: number of available languages

Examples:
  - GDPR ("32016R0679") → all 24 EU languages
  - Older acts may only have 11 or fewer languages`,
        inputSchema: z.object({
            celex: z.string().min(6).describe("CELEX number (e.g., '32016R0679')"),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ celex }) => {
        const langs = await getAvailableLanguages(celex).catch(err => {
            throw new Error(`Failed to get languages: ${err.message}`);
        });
        const normalized = normalizeCelex(celex);
        const hasSk = langs.includes("sk");
        const hasEn = langs.includes("en");
        const hasDe = langs.includes("de");
        const text = [
            `## Available Languages: ${normalized}`,
            "",
            `**Count:** ${langs.length} language(s)`,
            `**Languages:** ${langs.join(", ")}`,
            "",
            `**Slovak (sk):** ${hasSk ? "✅ Available" : "❌ Not available"}`,
            `**English (en):** ${hasEn ? "✅ Available" : "❌ Not available"}`,
            `**German (de):** ${hasDe ? "✅ Available" : "❌ Not available"}`,
        ].join("\n");
        return {
            content: [{ type: "text", text }],
            structuredContent: { celexNumber: normalized, availableLanguages: langs, count: langs.length },
        };
    });
    // ── eurlex_document_versions ────────────────────────────────────────────
    server.registerTool("eurlex_document_versions", {
        title: "Get All Versions and Amendments of a Document",
        description: `Retrieve the complete version history of an EU legal document, including original, amendments, corrigenda, and consolidated versions.

Essential for determining which version of a regulation applied at a specific point in time, and for tracking legislative evolution.

Args:
  - celex (string): CELEX number of the base document (e.g., "32016R0679")
  - response_format ("markdown" | "json"): Output format (default: "markdown")

Returns:
  List of related versions, each with:
  - celexNumber: CELEX of the version
  - type: "original" | "amendment" | "corrigendum" | "consolidated"
  - dateDocument: date of the version
  - ojReference: Official Journal reference

Examples:
  - "32016R0679" (GDPR) → original + any corrigenda
  - "31993L0013" (Unfair Contract Terms Directive) → original + amendments

Errors:
  - Returns just the original if no amendments found`,
        inputSchema: z.object({
            celex: z.string().min(6).describe("CELEX number (e.g., '32016R0679')"),
            response_format: z.enum(["markdown", "json"]).default("markdown"),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ celex, response_format }) => {
        const versions = await getDocumentVersions(celex).catch(err => {
            throw new Error(`Failed to get versions: ${err.message}`);
        });
        if (response_format === "json") {
            return {
                content: [{ type: "text", text: JSON.stringify(versions, null, 2) }],
                structuredContent: { versions, count: versions.length },
            };
        }
        const normalized = normalizeCelex(celex);
        const lines = [
            `## Version History: ${normalized}`,
            `*${versions.length} version(s) found*`,
            "",
        ];
        for (const v of versions) {
            const typeEmoji = { original: "📄", amendment: "✏️", corrigendum: "🔧", consolidated: "📋" }[v.type] ?? "📄";
            lines.push(`### ${typeEmoji} ${v.type.toUpperCase()}: ${v.celexNumber}`);
            if (v.dateDocument)
                lines.push(`**Date:** ${v.dateDocument}`);
            if (v.ojReference)
                lines.push(`**OJ Ref:** ${v.ojReference}`);
            if (v.title)
                lines.push(`**Title:** ${v.title}`);
            lines.push(`**EUR-Lex:** https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${v.celexNumber}`);
            lines.push("");
        }
        return {
            content: [{ type: "text", text: lines.join("\n") }],
            structuredContent: { versions, count: versions.length },
        };
    });
    // ── eurlex_document_compare ─────────────────────────────────────────────
    server.registerTool("eurlex_document_compare", {
        title: "Compare Two Document Versions or Language Editions",
        description: `Compare two EU legal documents — either different versions of the same act or the same act in different languages.

Useful for: identifying differences between an original act and its amendment, comparing Slovak and English texts for interpretation, or comparing pre- and post-amendment versions.

Args:
  - celex_a (string): CELEX number of the first document
  - lang_a (string): Language for document A (default: "en")
  - celex_b (string): CELEX number of the second document (same or different CELEX)
  - lang_b (string): Language for document B (default: "sk")
  - max_chars (number): Maximum chars from each document to compare (default: 10000)

Returns:
  Side-by-side comparison showing excerpts from both documents. For detailed differences, use eurlex_document_get on each document separately.

Examples:
  - Compare GDPR in EN vs SK: celex_a="32016R0679", lang_a="en", celex_b="32016R0679", lang_b="sk"
  - Compare original vs amendment: celex_a="31993L0013", celex_b="32011L0083", lang_a="en", lang_b="en"

Notes:
  - Full diff analysis requires reading both documents completely with eurlex_document_get
  - This tool shows a structured excerpt comparison`,
        inputSchema: z.object({
            celex_a: z.string().min(6).describe("First document CELEX (e.g., '32016R0679')"),
            lang_a: langSchema,
            celex_b: z.string().min(6).describe("Second document CELEX — can be same as celex_a for language comparison"),
            lang_b: z.enum([...SUPPORTED_LANGUAGES]).default("sk").describe("Language for document B (default: 'sk')"),
            max_chars: z.number().int().min(1000).max(20000).default(10000).describe("Max chars per document (default: 10000)"),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ celex_a, lang_a, celex_b, lang_b, max_chars }) => {
        const comparison = await compareDocuments(celex_a, lang_a, celex_b, lang_b, max_chars).catch(err => { throw new Error(`Comparison failed: ${err.message}`); });
        return {
            content: [{ type: "text", text: comparison }],
        };
    });
    // ── eurlex_document_find ────────────────────────────────────────────────────
    server.registerTool("eurlex_document_find", {
        title: "Find Text in a Document (Server-Side Grep)",
        description: `Search for specific text within an EU legal document — like grep, but server-side.

Token-efficient alternative to windowed reading: instead of fetching multiple 40 000-character chunks to locate a provision, this tool downloads the full document once, searches it internally, and returns only the matching excerpts. For a document like FR 2024/2509 (864 000 chars ≈ 22 chunks), finding "Article 8" costs 1 call instead of up to 22.

The full document is cached after the first call, so subsequent searches or eurlex_document_get calls on the same document are instant (no second HTTP round-trip).

Args:
  - celex (string): CELEX number (e.g., "32024R2509")
  - lang (string): Language code (default: "en")
  - query (string): Text to search for (case-insensitive). Plain string, or regex if use_regex=true.
  - context_chars (number): Characters of context shown around each match (default: 2000, max: 10000)
  - max_matches (number): Maximum matches to return (default: 5, max: 20)
  - use_regex (boolean): Treat query as a regular expression (default: false)
  - response_format ("markdown" | "json"): Output format (default: "markdown")

Returns:
  - matchCount: total occurrences in the document
  - matches[]: each with position (char offset), lineNumber, excerpt (context window around match)
  - truncated: true if more matches exist than max_matches

Examples:
  - Find Article 8: celex="32024R2509", query="Article 8", lang="en"
  - Find pre-financing interest rule in SK: celex="32024R2509", query="pre-financing", lang="sk"
  - Find recitals mentioning interest: celex="32012R0966", query="pre-financing payments", lang="en"
  - Regex search: celex="32024R2509", query="interest.*pre-financing", use_regex=true

After finding the right match, use eurlex_document_get with offset_chars=<position> for extended context.

Errors:
  - "no HTML manifestation found" — language unavailable; use eurlex_document_languages first
  - "Invalid regular expression" — syntax error when use_regex=true`,
        inputSchema: z.object({
            celex: z.string().min(6).describe("CELEX number (e.g., '32024R2509')"),
            lang: langSchema,
            query: z.string().min(1).max(500).describe("Text to search for (case-insensitive by default)"),
            context_chars: z.number().int().min(200).max(10_000).default(2_000).describe("Context chars around each match (default: 2000)"),
            max_matches: z.number().int().min(1).max(20).default(5).describe("Max matches to return (default: 5)"),
            use_regex: z.boolean().default(false).describe("Treat query as regex (default: false)"),
            response_format: z.enum(["markdown", "json"]).default("markdown"),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ celex, lang, query, context_chars, max_matches, use_regex, response_format }) => {
        const result = await findInDocument(celex, lang, query, context_chars, max_matches, use_regex).catch(err => { throw new Error(`Search failed: ${err.message}`); });
        if (response_format === "json") {
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                structuredContent: result,
            };
        }
        const normalized = normalizeCelex(celex);
        const lines = [
            `## Search: "${query}" in ${normalized} (${lang.toUpperCase()})`,
            `*Document size: ${result.totalChars.toLocaleString()} chars*`,
            `*Matches found: ${result.matchCount}${result.truncated ? ` (showing first ${max_matches})` : ""}*`,
            "",
        ];
        if (result.matchCount === 0) {
            lines.push(`*No matches found for "${query}".*`);
            lines.push("Tips:");
            lines.push("- Check language — terms may differ across translations");
            lines.push("- Try a shorter search string or use_regex=true for partial matches");
        }
        else {
            for (const m of result.matches) {
                lines.push(`### Match ${m.index + 1} — char ${m.position.toLocaleString()}${m.lineNumber ? ` (≈line ${m.lineNumber})` : ""}`);
                lines.push("```");
                lines.push(m.excerpt);
                lines.push("```");
                lines.push(`*→ More context: eurlex_document_get(celex="${normalized}", lang="${lang}", offset_chars=${Math.max(0, m.position - 500)})*`);
                lines.push("");
            }
            if (result.truncated) {
                lines.push(`*${result.matchCount - max_matches} more match(es) — increase max_matches or refine query.*`);
            }
        }
        return {
            content: [{ type: "text", text: lines.join("\n") }],
            structuredContent: result,
        };
    });
}
//# sourceMappingURL=document-tools.js.map