import { z } from "zod";
import { parseCelex, normalizeCelex } from "./celex-parser.js";
import { getMetadata, checkCitationAtDate } from "./eurlex-client.js";
export function registerCitationTools(server) {
    // ── eurlex_celex_parse ──────────────────────────────────────────────────
    server.registerTool("eurlex_celex_parse", {
        title: "Parse CELEX Number",
        description: `Parse and decompose a CELEX number into its constituent parts.

CELEX numbers identify EU legal documents uniquely. This tool breaks down the number into sector, year, document type, and sequence number, returning a human-readable description.

Args:
  - celex (string): CELEX number to parse (e.g., "32016R0679", "32000L0060", "61994J0415")

Returns:
  Structured breakdown with:
  - raw: normalized CELEX (uppercase)
  - sector: single character (e.g., "3" = Acts of institutions)
  - sectorDescription: human-readable sector name
  - year: 4-digit year string
  - documentType: type code (e.g., "R" = Regulation, "L" = Directive)
  - documentTypeDescription: human-readable type
  - documentNumber: sequence number
  - isConsolidated: true if sector 0 (consolidated legislation)
  - humanReadable: full description (e.g., "Regulation No 679/2016")

Examples:
  - "32016R0679" → GDPR: Regulation 679/2016 (Sector 3, Acts)
  - "32000L0060" → Water Framework Directive: Directive 60/2000
  - "61994J0415" → EU Court case judgment

Errors:
  - Returns error if CELEX number format is invalid`,
        inputSchema: z.object({
            celex: z.string().min(6).describe("CELEX number to parse (e.g., '32016R0679')"),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }, async ({ celex }) => {
        const result = parseCelex(celex);
        if (!result.valid || !result.parsed) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${result.error}` }],
            };
        }
        const p = result.parsed;
        const text = [
            `## CELEX: ${p.raw}`,
            "",
            `**Human-readable:** ${p.humanReadable}`,
            `**Sector:** ${p.sector} — ${p.sectorDescription}`,
            `**Year:** ${p.year}`,
            `**Document type:** ${p.documentType} — ${p.documentTypeDescription}`,
            `**Document number:** ${parseInt(p.documentNumber, 10)}`,
            p.suffix ? `**Suffix:** ${p.suffix}` : "",
            `**Consolidated:** ${p.isConsolidated ? "Yes (sector 0)" : "No"}`,
        ].filter(Boolean).join("\n");
        return {
            content: [{ type: "text", text }],
            structuredContent: p,
        };
    });
    // ── eurlex_celex_validate ───────────────────────────────────────────────
    server.registerTool("eurlex_celex_validate", {
        title: "Validate CELEX Number and Get Document Metadata",
        description: `Verify that a CELEX number corresponds to a real document in EUR-Lex and retrieve its metadata.

Use this tool to confirm a citation is valid before using it in legal documents, check whether a regulation/directive is still in force, and retrieve Official Journal references.

Args:
  - celex (string): CELEX number to validate (e.g., "32016R0679")
  - response_format ("markdown" | "json"): Output format (default: "markdown")

Returns:
  - celexNumber: normalized CELEX
  - title: document title (English)
  - documentType: type of act
  - dateDocument: date of the document
  - datePublication: date of publication in OJ
  - ojReference: Official Journal reference (e.g., "OJ L 119, 4.5.2016")
  - inForce: whether the document is currently in force
  - eli: European Legislation Identifier URI
  - status: "found" or "not_found"

Examples:
  - "32016R0679" → GDPR, in force, OJ L 119
  - "31993L0013" → Unfair Contract Terms Directive
  - "99999X9999" → not found (error)

Errors:
  - Returns not_found status if document does not exist in EUR-Lex`,
        inputSchema: z.object({
            celex: z.string().min(6).describe("CELEX number to validate (e.g., '32016R0679')"),
            response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ celex, response_format }) => {
        // First validate format
        const parseResult = parseCelex(celex);
        if (!parseResult.valid) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error: Invalid CELEX format — ${parseResult.error}` }],
            };
        }
        const normalized = normalizeCelex(celex);
        const metadata = await getMetadata(normalized).catch(err => {
            throw new Error(`Failed to query EUR-Lex: ${err.message}`);
        });
        if (!metadata) {
            const output = { status: "not_found", celexNumber: normalized };
            if (response_format === "json") {
                return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
            }
            return {
                isError: true,
                content: [{ type: "text", text: `Document **${normalized}** not found in EUR-Lex database.\n\nPlease verify the CELEX number is correct.` }],
            };
        }
        const output = { ...metadata, status: "found" };
        if (response_format === "json") {
            return {
                content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
                structuredContent: output,
            };
        }
        const lines = [
            `## ✅ ${normalized} — Found in EUR-Lex`,
            "",
            metadata.title ? `**Title:** ${metadata.title}` : "",
            metadata.documentType ? `**Type:** ${metadata.documentType}` : "",
            metadata.dateDocument ? `**Date of document:** ${metadata.dateDocument}` : "",
            metadata.datePublication ? `**Date of publication:** ${metadata.datePublication}` : "",
            metadata.ojReference ? `**Official Journal:** ${metadata.ojReference}` : "",
            `**In force:** ${metadata.inForce === true ? "✅ Yes" : metadata.inForce === false ? "❌ No" : "⚠️ Unknown"}`,
            metadata.eli ? `**ELI:** ${metadata.eli}` : "",
            "",
            `**EUR-Lex link:** https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${normalized}`,
        ].filter(Boolean).join("\n");
        return {
            content: [{ type: "text", text: lines }],
            structuredContent: output,
        };
    });
    // ── eurlex_citation_check ───────────────────────────────────────────────
    server.registerTool("eurlex_citation_check", {
        title: "Assess Citation Status at a Specific Date",
        description: `Assess whether a cited EU legal act was in force on a specific date using explicit EUR-Lex entry-into-force and end-of-validity metadata.

Critical for legal documents, court submissions, and compliance assessments where the applicable version of law at a specific point in time must be established.

This tool does not treat the document/adoption date as entry into force. If EUR-Lex does not return enough historical validity metadata, or the requested date is in the future, the result is unknown rather than a guessed yes/no answer. Entry into force is also distinct from application; confirm applicability in the act's official text.

Args:
  - celex (string): CELEX number of the act to check (e.g., "32016R0679")
  - check_date (string): Date to check validity on, ISO 8601 format "YYYY-MM-DD" (e.g., "2018-05-25")
  - response_format ("markdown" | "json"): Output format (default: "markdown")

Returns:
  - celexNumber: the validated CELEX number
  - checkDate: the date that was checked
  - wasValid: boolean | null — true/false only when the returned validity dates support it; null means unknown
  - validityStatus: "in_force" | "not_in_force" | "unknown" | "not_found"
  - dateDocument: when the act was signed/adopted
  - dateEntryIntoForce: the explicit EUR-Lex entry-into-force date, when available
  - dateEndValidity: when the act expired (if it did)
  - currentStatus: current in-force status
  - note: human-readable explanation

Examples:
  - GDPR on 2018-01-01 → wasValid: true when EUR-Lex returns its 24 May 2016 entry-into-force date; this does not assert that every provision was already applicable
  - A document with only an adoption date → wasValid: null, validityStatus: "unknown"

Errors:
  - Returns wasValid: null and validityStatus: "not_found" if the document is not found`,
        inputSchema: z.object({
            celex: z.string().min(6).describe("CELEX number (e.g., '32016R0679')"),
            check_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format").describe("Date to check, format YYYY-MM-DD (e.g., '2018-05-25')"),
            response_format: z.enum(["markdown", "json"]).default("markdown"),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ celex, check_date, response_format }) => {
        const parseResult = parseCelex(celex);
        if (!parseResult.valid) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error: Invalid CELEX format — ${parseResult.error}` }],
            };
        }
        const result = await checkCitationAtDate(celex, check_date).catch(err => {
            throw new Error(`Citation check failed: ${err.message}`);
        });
        if (response_format === "json") {
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                structuredContent: result,
            };
        }
        const icon = result.validityStatus === "in_force" ? "✅" : result.validityStatus === "not_in_force" ? "❌" : "⚠️";
        const historicalStatus = result.validityStatus === "in_force"
            ? "YES — act was in force"
            : result.validityStatus === "not_in_force"
                ? "NO — act was not in force"
                : result.validityStatus === "not_found"
                    ? "UNKNOWN — document not found"
                    : "UNKNOWN — insufficient historical validity metadata";
        const lines = [
            `## ${icon} Citation Check: ${result.celexNumber} on ${result.checkDate}`,
            "",
            `**Historical status on ${result.checkDate}:** ${historicalStatus}`,
            result.dateDocument ? `**Document/adoption date (not used as effective date):** ${result.dateDocument}` : "",
            result.dateEntryIntoForce ? `**Entry into force:** ${result.dateEntryIntoForce}` : "",
            result.dateEndValidity ? `**End of validity:** ${result.dateEndValidity}` : "",
            `**Current EUR-Lex status (not historical):** ${result.currentStatus}`,
            "",
            `**Note:** ${result.note}`,
            "**Scope:** Entry into force is not the same as applicability. Verify the act and relevant version in the official EUR-Lex text before relying on the result.",
            "",
            `**EUR-Lex link:** https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${result.celexNumber}`,
        ].filter(Boolean).join("\n");
        return {
            content: [{ type: "text", text: lines }],
            structuredContent: result,
        };
    });
}
//# sourceMappingURL=citation-tools.js.map