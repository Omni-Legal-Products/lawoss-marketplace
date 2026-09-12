import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { looseBoolean, looseNumber } from "./scalars.js";
import { searchContracts } from "./crz/search.js";
import { getContract } from "./crz/contract.js";
import { listAttachments, downloadAttachment, saveAttachmentToPath } from "./crz/attachments.js";
import { contractToMarkdown, summarizeContract } from "./crz/markdown.js";
import { extractClauses } from "./crz/clauses.js";
import { findSimilar } from "./crz/similar.js";
import { listRecent, whatsNew } from "./crz/recent.js";
export const SERVER_NAME = "crz-mcp";
export const SERVER_VERSION = "1.3.1";
function jsonContent(obj) {
    return {
        content: [
            { type: "text", text: JSON.stringify(obj, null, 2) },
        ],
    };
}
function textContent(text) {
    return { content: [{ type: "text", text }] };
}
function errorContent(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
        content: [{ type: "text", text: `CRZ MCP error: ${msg}` }],
        isError: true,
    };
}
export function buildServer() {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
    // crz_search ------------------------------------------------------
    server.registerTool("crz_search", {
        title: "Search CRZ contracts",
        description: "Search the Centrálny register zmlúv (https://crz.gov.sk) by free-text, parties, IČO, contract number, ministry, price range, and date range. Returns metadata rows; use `crz_get_contract` for details.",
        inputSchema: {
            q: z.string().optional().describe("Free-text query (title / subject)."),
            dodavatel: z.string().optional().describe("Supplier name fragment."),
            objednavatel: z.string().optional().describe("Contracting authority name fragment."),
            ico: z.string().optional().describe("IČO (business id) of either party."),
            cislo_zmluvy: z.string().optional().describe("Contract number."),
            rezort: z.string().optional().describe("Government ministry / department."),
            cena_min: looseNumber(z.number()).optional().describe("Minimum price (EUR with VAT)."),
            cena_max: looseNumber(z.number()).optional().describe("Maximum price (EUR with VAT)."),
            datum_od: z.string().optional().describe("Publication date from (YYYY-MM-DD)."),
            datum_do: z.string().optional().describe("Publication date to (YYYY-MM-DD)."),
            page: looseNumber(z.number().int().min(1)).optional().describe("Page (1-based)."),
            limit: looseNumber(z.number().int().min(1).max(50)).optional().describe("Max rows to return (default 20, max 50). CRZ paginates at 20/page; the server walks extra pages to fill the limit."),
        },
    }, async (input) => {
        try {
            const r = await searchContracts(input);
            return jsonContent(r);
        }
        catch (e) {
            return errorContent(e);
        }
    });
    // crz_recent ------------------------------------------------------
    server.registerTool("crz_recent", {
        title: "List newest CRZ contracts",
        description: "List the most recently published CRZ contracts (newest first), optionally narrowed by supplier, contracting authority, IČO, ministry, or free text. Walks as many pages as needed to reach `limit`. Returns `max_id` (the highest id seen) — pass it to `crz_whats_new` later to fetch only what appeared since.",
        inputSchema: {
            q: z.string().optional().describe("Free-text query (title / subject)."),
            dodavatel: z.string().optional().describe("Supplier name fragment."),
            objednavatel: z.string().optional().describe("Contracting authority name fragment."),
            ico: z.string().optional().describe("IČO (business id) of either party."),
            rezort: z.string().optional().describe("Government ministry / department."),
            limit: looseNumber(z.number().int().min(1).max(200)).optional().describe("Max contracts to return (default 20, max 200)."),
        },
    }, async ({ q, dodavatel, objednavatel, ico, rezort, limit }) => {
        try {
            const r = await listRecent({ q, dodavatel, objednavatel, ico, rezort }, limit ?? 20);
            return jsonContent({ count: r.results.length, ...r });
        }
        catch (e) {
            return errorContent(e);
        }
    });
    // crz_whats_new ---------------------------------------------------
    server.registerTool("crz_whats_new", {
        title: "Check for new CRZ contracts since a watermark",
        description: "Return contracts published since a previous check. Provide `since_id` (the `max_id` from a previous `crz_recent`/`crz_whats_new` call) and/or `since_date` (YYYY-MM-DD). Walks newest-first pages until it reaches already-seen contracts. Returns the new rows plus an updated `max_id` to store for the next check. Optionally filter by party / ministry.",
        inputSchema: {
            since_id: z.string().optional().describe("Highest CRZ contract id already seen (from a previous `max_id`)."),
            since_date: z.string().optional().describe("Only contracts published on/after this date (YYYY-MM-DD)."),
            q: z.string().optional().describe("Free-text query (title / subject)."),
            dodavatel: z.string().optional().describe("Supplier name fragment."),
            objednavatel: z.string().optional().describe("Contracting authority name fragment."),
            ico: z.string().optional().describe("IČO (business id) of either party."),
            rezort: z.string().optional().describe("Government ministry / department."),
            max_pages: looseNumber(z.number().int().min(1).max(50)).optional().describe("Safety bound on pages to scan back (default 10 = 500 rows)."),
        },
    }, async ({ since_id, since_date, q, dodavatel, objednavatel, ico, rezort, max_pages }) => {
        try {
            const r = await whatsNew({ sinceId: since_id, sinceDate: since_date }, { filters: { q, dodavatel, objednavatel, ico, rezort }, maxPages: max_pages });
            return jsonContent({ count: r.results.length, ...r });
        }
        catch (e) {
            return errorContent(e);
        }
    });
    // crz_get_contract ------------------------------------------------
    server.registerTool("crz_get_contract", {
        title: "Get CRZ contract metadata",
        description: "Fetch full parsed metadata for a single CRZ contract by id.",
        inputSchema: {
            id: z.string().describe("CRZ contract id (numeric, passed as string)."),
            fresh: looseBoolean().optional().describe("Bypass cache and refetch."),
        },
    }, async ({ id, fresh }) => {
        try {
            return jsonContent(await getContract(id, { fresh }));
        }
        catch (e) {
            return errorContent(e);
        }
    });
    // crz_list_attachments -------------------------------------------
    server.registerTool("crz_list_attachments", {
        title: "List attachments of a CRZ contract",
        description: "Return the list of downloadable files (file_id, name, ext, size, url) for a contract.",
        inputSchema: { id: z.string().describe("CRZ contract id (numeric, passed as string).") },
    }, async ({ id }) => {
        try {
            return jsonContent(await listAttachments(id));
        }
        catch (e) {
            return errorContent(e);
        }
    });
    // crz_download_attachment ----------------------------------------
    server.registerTool("crz_download_attachment", {
        title: "Download a CRZ attachment",
        description: "Download an attachment by its CRZ file_id. If `save_path` is given, the file is written to disk; otherwise the bytes are returned as base64. Use `ext` if the extension isn't `.pdf`.",
        inputSchema: {
            file_id: z.string().describe("CRZ attachment file id (numeric, passed as string; from /data/att/<id>.<ext>)."),
            ext: z.string().optional().describe("File extension (pdf, docx, doc, rtf, ...). If omitted, common extensions are tried."),
            save_path: z.string().optional().describe("If provided, write the bytes to this absolute path (or directory ending with /)."),
        },
    }, async ({ file_id, ext, save_path }) => {
        try {
            if (save_path) {
                const saved = await saveAttachmentToPath(String(file_id), save_path, ext);
                return jsonContent(saved);
            }
            const dl = await downloadAttachment(String(file_id), ext);
            return jsonContent({
                file_id: dl.file_id,
                ext: dl.ext,
                mime: dl.mime,
                bytes: dl.bytes,
                base64: dl.buffer.toString("base64"),
                url: dl.url,
            });
        }
        catch (e) {
            return errorContent(e);
        }
    });
    // crz_contract_to_markdown ---------------------------------------
    server.registerTool("crz_contract_to_markdown", {
        title: "Convert a CRZ contract to Markdown",
        description: "Fetch a contract and convert its metadata + all attachments to clean Markdown for LLM reading. Optionally save to a directory.",
        inputSchema: {
            id: z.string().describe("CRZ contract id (numeric, passed as string)."),
            include_attachments: looseBoolean().optional().describe("Download and convert attachments too (default true)."),
            save_to_dir: z.string().optional().describe("Directory to write `<id>.md` and per-attachment `.md` files."),
        },
    }, async ({ id, include_attachments, save_to_dir }) => {
        try {
            const result = await contractToMarkdown(id, { include_attachments, save_to_dir });
            const summary = {
                id: result.id,
                saved_dir: result.saved_dir,
                attachment_count: result.attachments.length,
                attachments: result.attachments.map((a) => ({
                    file_id: a.file_id,
                    name: a.name,
                    ext: a.ext,
                    bytes: a.bytes,
                    chars: a.markdown.length,
                    warnings: a.warnings,
                    saved_path: a.saved_path,
                })),
            };
            return {
                content: [
                    { type: "text", text: JSON.stringify(summary, null, 2) },
                    { type: "text", text: result.full_markdown },
                ],
            };
        }
        catch (e) {
            return errorContent(e);
        }
    });
    // crz_extract_clauses --------------------------------------------
    server.registerTool("crz_extract_clauses", {
        title: "Extract typical contract clauses",
        description: "Heuristically pull standard Slovak clauses (Predmet, Cena, Platobné podmienky, Sankcie, Doba a ukončenie, Rozhodné právo, Záverečné ustanovenia, Prílohy) from a contract — either by id (which fetches and converts it) or by passing raw markdown.",
        inputSchema: {
            id: z.string().optional().describe("CRZ contract id (numeric, passed as string) — fetched & converted automatically."),
            markdown: z.string().optional().describe("Raw Markdown / plain text to analyse instead of fetching."),
        },
    }, async ({ id, markdown }) => {
        try {
            if (!id && !markdown)
                throw new Error("Provide either `id` or `markdown`.");
            let md = markdown;
            if (!md) {
                const r = await contractToMarkdown(id);
                md = r.full_markdown;
            }
            return jsonContent(extractClauses(md));
        }
        catch (e) {
            return errorContent(e);
        }
    });
    // crz_summarize_contract -----------------------------------------
    server.registerTool("crz_summarize_contract", {
        title: "Summarize a CRZ contract",
        description: "Return a short, deterministic factual summary (one paragraph) built from parsed metadata — parties, dates, price, ministry. No LLM call inside; safe for chaining.",
        inputSchema: { id: z.string().describe("CRZ contract id (numeric, passed as string).") },
    }, async ({ id }) => {
        try {
            const c = await getContract(id);
            return textContent(summarizeContract(c));
        }
        catch (e) {
            return errorContent(e);
        }
    });
    // crz_find_similar_contracts -------------------------------------
    server.registerTool("crz_find_similar_contracts", {
        title: "Find similar CRZ contracts",
        description: "Find candidate drafting-template contracts. Seed can be a contract id (parties + title keywords used) or an explicit parties/keywords object.",
        inputSchema: {
            id: z.string().optional().describe("Seed contract id (numeric, passed as string)."),
            dodavatel: z.string().optional().describe("Supplier name to seed search."),
            objednavatel: z.string().optional().describe("Contracting authority name to seed search."),
            keywords: z.array(z.string()).optional().describe("Explicit subject keywords."),
            limit: looseNumber(z.number().int().min(1).max(50)).optional().describe("Max results (default 10)."),
        },
    }, async ({ id, dodavatel, objednavatel, keywords, limit }) => {
        try {
            if (id == null && !dodavatel && !objednavatel && !(keywords && keywords.length)) {
                throw new Error("Provide either `id` or at least one of `dodavatel`, `objednavatel`, `keywords`.");
            }
            const r = await findSimilar({ id, parties: { dodavatel, objednavatel }, keywords }, limit ?? 10);
            return jsonContent({ count: r.length, results: r });
        }
        catch (e) {
            return errorContent(e);
        }
    });
    return server;
}
//# sourceMappingURL=server.js.map