import { z } from "zod";
import { normalizeCelex } from "./celex-parser.js";
import { findRelatedDocuments, searchFullText, eliToCelex, celexToEli, normalizeEli } from "./eurlex-client.js";
export function registerSearchTools(server) {
    // ── eurlex_related_find ─────────────────────────────────────────────────
    server.registerTool("eurlex_related_find", {
        title: "Find Related Legal Documents",
        description: `Find EU legal documents related to a given act — its legal basis, acts based on it, amendments, national transposition measures, and repeals — from the EUR-Lex CELLAR relationship data.

Use this to understand the legislative context of a regulation or directive, find national transposition measures, or trace the legal basis chain.

Args:
  - celex (string): CELEX number of the base document (e.g., "32016R0679")
  - relationship ("all" | "cites" | "cited_by" | "amends" | "amended_by" | "transposes" | "transposed_by" | "repeals" | "repealed_by"): Filter by relationship type (default: "all")
  - limit (number): Maximum results to return (default: 20, max: 50)
  - response_format ("markdown" | "json"): Output format (default: "markdown")

Returns:
  - documents: related documents (celexNumber, relationship, title in English if available — national measures carry their national-language title —, dateDocument)
  - totals: number of related documents per relationship according to CELLAR
  - truncated: true if more related documents exist than returned (raise limit or filter by relationship)

Relationship types:
  - "cites": acts this document names as its legal basis (CELLAR "based on"; not every citation)
  - "cited_by": acts adopted on the basis of this document
  - "amends" / "amended_by": amendment relationships
  - "transposes": directives a national measure (CELEX sector 7) transposes
  - "transposed_by": national measures transposing this directive, as notified to EUR-Lex
  - "repeals" / "repealed_by": repeal relationships (implicit repeals are marked)

With relationship="all", results are shared round-robin across relationship types, so check totals.

Examples:
  - GDPR: celex="32016R0679", relationship="repeals" → Directive 95/46/EC
  - Directive 95/46/EC: celex="31995L0046", relationship="repealed_by" → GDPR
  - Unfair Terms Directive transpositions: celex="31993L0013", relationship="transposed_by"`,
        inputSchema: z.object({
            celex: z.string().min(6).describe("CELEX number (e.g., '32016R0679')"),
            relationship: z.enum(["all", "cites", "cited_by", "amends", "amended_by", "transposes", "transposed_by", "repeals", "repealed_by"])
                .default("all")
                .describe("Relationship type filter (default: 'all')"),
            limit: z.number().int().min(1).max(50).default(20).describe("Max results (default: 20)"),
            response_format: z.enum(["markdown", "json"]).default("markdown"),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ celex, relationship, limit, response_format }) => {
        const result = await findRelatedDocuments(celex, relationship, limit).catch(err => {
            throw new Error(`Failed to find related documents: ${err.message}`);
        });
        const docs = result.documents;
        const structured = { documents: docs, count: docs.length, totals: result.totals, truncated: result.truncated };
        if (response_format === "json") {
            return {
                content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
                structuredContent: structured,
            };
        }
        const normalized = normalizeCelex(celex);
        const totalsText = Object.entries(result.totals).map(([rel, n]) => `${rel}: ${n}`).join(", ");
        const lines = [
            `## Related Documents: ${normalized}`,
            relationship !== "all" ? `*Filtered by: ${relationship}*` : "",
            `*${docs.length} document(s) shown${result.truncated ? " — more exist, see totals" : ""}*`,
            totalsText ? `*Totals in EUR-Lex (CELLAR): ${totalsText}*` : "",
            "",
        ].filter(Boolean);
        if (!docs.length) {
            lines.push(`*EUR-Lex (CELLAR) records no ${relationship === "all" ? "" : `"${relationship}" `}relationships for this document.*`);
        }
        // Group by relationship type
        const grouped = {};
        for (const d of docs) {
            grouped[d.relationship] = grouped[d.relationship] ?? [];
            grouped[d.relationship].push(d);
        }
        const relEmoji = {
            cites: "📎", cited_by: "🔗", amends: "✏️", amended_by: "📝",
            transposes: "🇪🇺", transposed_by: "🏛️", repeals: "❌", repealed_by: "🔴",
        };
        const relLabel = {
            cites: "LEGAL BASIS (cites)", cited_by: "ADOPTED ON THIS BASIS (cited_by)",
        };
        for (const [rel, relDocs] of Object.entries(grouped)) {
            const total = result.totals[rel];
            lines.push(`### ${relEmoji[rel] ?? "📄"} ${relLabel[rel] ?? rel.replace(/_/g, " ").toUpperCase()} (${relDocs.length}${total !== undefined && total > relDocs.length ? ` of ${total}` : ""})`);
            for (const d of relDocs) {
                lines.push(`- **${d.celexNumber}**${d.dateDocument ? ` (${d.dateDocument})` : ""}${d.title ? ` — ${d.title}` : ""}${d.note ? ` *(${d.note})*` : ""}`);
            }
            lines.push("");
        }
        return {
            content: [{ type: "text", text: lines.join("\n") }],
            structuredContent: structured,
        };
    });
    // ── eurlex_search_full_text ─────────────────────────────────────────────
    server.registerTool("eurlex_search_full_text", {
        title: "Full-Text Search in EUR-Lex",
        description: `Search the EUR-Lex database by keyword, legal concept, or CELEX number using the EUR-Lex Web Service.

REQUIRES REGISTRATION: This tool requires EURLEX_WS_USERNAME and EURLEX_WS_PASSWORD environment variables.

⚠️  MANDATORY — TRANSLATE QUERY TO ENGLISH BEFORE CALLING THIS TOOL:
EUR-Lex full-text index is English-only. If the user's query is in any other language (Slovak, German, French, etc.),
you MUST translate it to English yourself before passing it as the query argument.
Example: user asks "nariadenie o umelej inteligencii" → you pass "artificial intelligence act regulation".
CELEX numbers (e.g. "32016R0679") and expert syntax (DN =, TI ~) do NOT need translation.

After finding the CELEX number, use eurlex_document_get(celex=..., lang="sk") to read the document in Slovak.

Auto-normalization: plain keywords → TI ~ query (title search); plain CELEX numbers → DN = CELEX (exact lookup).
For explicit control use EUR-Lex expert query syntax directly.

Args:
  - query (string): Keywords in ENGLISH (translate if needed), CELEX number, or EUR-Lex expert query syntax
  - limit (number): Results per page (default: 10, max: 50)
  - offset (number): Pagination offset for paging through results (default: 0)
  - response_format ("markdown" | "json"): Output format (default: "markdown")

Returns:
  List of matching documents with CELEX numbers, titles, dates.
  Pagination metadata: total, has_more, next_offset.

Query examples (auto-normalized):
  - "GDPR" → auto: TI ~ GDPR (title search)
  - "32016R0679" → auto: DN = 32016R0679 (exact CELEX lookup)
  - "NIS2 cybersecurity directive" → auto: TI ~ NIS2 cybersecurity directive

EUR-Lex expert query syntax (used as-is when operators detected):
  - DN = 32016R0679     → exact document by CELEX number
  - TI ~ GDPR          → title contains "GDPR"
  - AU ~ Commission    → authored by Commission
  - DC ~ competition   → subject matter contains "competition"

Valid boolean: AND, OR, NOT  (e.g. TI ~ GDPR AND AU ~ Parliament)

Errors:
  - "credentials not configured" if EURLEX_WS_USERNAME/PASSWORD not set`,
        inputSchema: z.object({
            query: z.string().min(2).max(500).describe("Search query in English, or EUR-Lex expert syntax"),
            limit: z.number().int().min(1).max(50).default(10).describe("Results per page (default: 10)"),
            offset: z.number().int().min(0).default(0).describe("Pagination offset (default: 0)"),
            response_format: z.enum(["markdown", "json"]).default("markdown"),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ query, limit, offset, response_format }) => {
        const result = await searchFullText(query, "en", limit, offset).catch(err => {
            throw new Error(err.message);
        });
        if (response_format === "json") {
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                structuredContent: result,
            };
        }
        const lines = [
            `## EUR-Lex Search: "${query}"`,
            `*Results ${offset + 1}–${offset + result.results.length} of ${result.total}*`,
            result.hasMore ? `*More results available — use offset: ${offset + result.results.length}*` : "",
            "",
        ].filter(Boolean);
        if (!result.results.length) {
            lines.push("*No results found. Try broader search terms.*");
        }
        for (const r of result.results) {
            lines.push(`### ${r.celexNumber}`);
            if (r.title)
                lines.push(`**${r.title}**`);
            if (r.dateDocument)
                lines.push(`Date: ${r.dateDocument}`);
            if (r.documentType)
                lines.push(`Type: ${r.documentType}`);
            lines.push(`EUR-Lex: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${r.celexNumber}`);
            lines.push("");
        }
        return {
            content: [{ type: "text", text: lines.join("\n") }],
            structuredContent: result,
        };
    });
    // ── eurlex_eli_resolve ──────────────────────────────────────────────────
    server.registerTool("eurlex_eli_resolve", {
        title: "Resolve Between ELI URI and CELEX Number",
        description: `Convert between ELI (European Legislation Identifier) URIs and CELEX numbers.

ELI is the modern European standard for identifying legislation across member states. Use this to translate between the two identification systems, or to find the canonical ELI URI for a known CELEX number.

Args:
  - identifier (string): Either a CELEX number (e.g., "32016R0679") or an ELI URI (e.g., "http://data.europa.eu/eli/reg/2016/679/oj"; https:// and http://publications.europa.eu/resource/eli/... are accepted too)
  - direction ("auto" | "celex_to_eli" | "eli_to_celex"): Conversion direction (default: "auto" — detected from input format)

Returns:
  - input: the provided identifier
  - output: the converted identifier
  - direction: which conversion was performed
  - eurLexUrl: direct EUR-Lex link

Examples:
  - CELEX to ELI: "32016R0679" → "http://data.europa.eu/eli/reg/2016/679/oj"
  - ELI to CELEX: "http://data.europa.eu/eli/reg/2016/679/oj" → "32016R0679"

Errors:
  - "No ELI found" if EUR-Lex returned no ELI for the CELEX number (older acts, case law and many non-legislative documents have none)
  - "No CELEX found" if the ELI does not resolve to a CELEX number
  - "Unrecognized ELI" if the identifier is not an EU ELI URI`,
        inputSchema: z.object({
            identifier: z.string().min(6).describe("CELEX number or ELI URI"),
            direction: z.enum(["auto", "celex_to_eli", "eli_to_celex"]).default("auto").describe("Conversion direction (default: 'auto')"),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ identifier, direction }) => {
        const isEli = identifier.startsWith("http://") || identifier.startsWith("https://");
        const actualDirection = direction === "auto"
            ? (isEli ? "eli_to_celex" : "celex_to_eli")
            : direction;
        let output = null;
        if (actualDirection === "celex_to_eli") {
            output = await celexToEli(identifier).catch(err => {
                throw new Error(`ELI lookup failed: ${err.message}`);
            });
            if (!output) {
                return {
                    isError: true,
                    content: [{ type: "text", text: `No ELI found for CELEX: ${identifier}. EUR-Lex (CELLAR) returned no ELI for this document; check the CELEX number with eurlex_celex_validate.` }],
                };
            }
        }
        else {
            if (!normalizeEli(identifier)) {
                return {
                    isError: true,
                    content: [{ type: "text", text: `Unrecognized ELI: ${identifier}. Expected an EU ELI such as http://data.europa.eu/eli/reg/2016/679/oj` }],
                };
            }
            output = await eliToCelex(identifier).catch(err => {
                throw new Error(`CELEX lookup failed: ${err.message}`);
            });
            if (!output) {
                return {
                    isError: true,
                    content: [{ type: "text", text: `No CELEX found for ELI: ${identifier}` }],
                };
            }
        }
        const celex = actualDirection === "celex_to_eli" ? identifier : output;
        const eli = actualDirection === "celex_to_eli" ? output : (normalizeEli(identifier) ?? identifier);
        const result = {
            input: identifier,
            output,
            direction: actualDirection,
            celex: normalizeCelex(celex),
            eli,
            eurLexUrl: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${normalizeCelex(celex)}`,
        };
        const text = [
            `## ELI ↔ CELEX Resolution`,
            "",
            `**Input (${actualDirection === "celex_to_eli" ? "CELEX" : "ELI"}):** ${identifier}`,
            `**Output (${actualDirection === "celex_to_eli" ? "ELI" : "CELEX"}):** ${output}`,
            "",
            `**EUR-Lex link:** ${result.eurLexUrl}`,
        ].join("\n");
        return {
            content: [{ type: "text", text }],
            structuredContent: result,
        };
    });
}
//# sourceMappingURL=search-tools.js.map