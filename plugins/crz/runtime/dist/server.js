import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { looseBoolean, looseNumber } from "./scalars.js";
import { searchContracts } from "./crz/search.js";
import { getContract } from "./crz/contract.js";
import { listAttachments, downloadAttachment, saveAttachmentToPath } from "./crz/attachments.js";
import { contractToMarkdown, summarizeContract } from "./crz/markdown.js";
import { extractClauses, hasNoContractText } from "./crz/clauses.js";
import { findSimilarDetailed } from "./crz/similar.js";
import { listRecent, whatsNew } from "./crz/recent.js";
export const SERVER_NAME = "crz-mcp";
export const SERVER_VERSION = "1.4.0";
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
        description: "Search the Centrálny register zmlúv (https://crz.gov.sk) by contract title, parties, IČO, contract number, ministry, price range, and publication date range. Returns metadata rows; use `crz_get_contract` for details. To continue, call again with `page: next_page` and `offset: next_offset` (no rows are skipped). `total_pages_hint` is set only when CRZ shows the exact page count; otherwise `total_pages_at_least` is a lower bound.",
        inputSchema: {
            q: z.string().optional().describe("Contract title fragment (CRZ field \"Názov zmluvy\")."),
            dodavatel: z.string().optional().describe("Supplier name fragment."),
            objednavatel: z.string().optional().describe("Contracting authority name fragment."),
            ico: z.string().optional().describe("IČO of either party: CRZ is queried both as supplier (art_ico) and as contracting authority (art_ico1) and the rows are merged; each row says where it matched in `ico_zhoda`."),
            ico_dodavatel: z.string().optional().describe("IČO of the supplier only (CRZ art_ico). Do not combine with `ico`."),
            ico_objednavatel: z.string().optional().describe("IČO of the contracting authority only (CRZ art_ico1). Do not combine with `ico`."),
            cislo_zmluvy: z.string().optional().describe("Contract number."),
            rezort: z.string().optional().describe("Government ministry / department."),
            cena_min: looseNumber(z.number()).optional().describe("Minimum price (EUR with VAT)."),
            cena_max: looseNumber(z.number()).optional().describe("Maximum price (EUR with VAT)."),
            datum_od: z.string().optional().describe("Publication date from (YYYY-MM-DD; DD.MM.YYYY also accepted). An invalid date is an error, never ignored."),
            datum_do: z.string().optional().describe("Publication date to (YYYY-MM-DD; DD.MM.YYYY also accepted). An invalid date is an error, never ignored."),
            page: looseNumber(z.number().int().min(1)).optional().describe("Page (1-based)."),
            offset: looseNumber(z.number().int().min(0).max(39)).optional().describe("Rows of `page` to skip — pass the previous `next_offset` together with `page: next_page`."),
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
        description: "List the most recently published CRZ contracts (newest first), optionally narrowed by supplier, contracting authority, IČO, ministry, or contract title. Walks as many pages as needed to reach `limit`. Returns `max_datum` (newest publication date among the returned rows) and `max_id` (highest returned id). For later monitoring pass `max_datum` as `since_date` to `crz_whats_new` and dedupe by id; `max_id` alone cannot guarantee completeness.",
        inputSchema: {
            q: z.string().optional().describe("Contract title fragment (CRZ field \"Názov zmluvy\")."),
            dodavatel: z.string().optional().describe("Supplier name fragment."),
            objednavatel: z.string().optional().describe("Contracting authority name fragment."),
            ico: z.string().optional().describe("IČO of either party: CRZ is queried both as supplier (art_ico) and as contracting authority (art_ico1) and the rows are merged; each row says where it matched in `ico_zhoda`."),
            ico_dodavatel: z.string().optional().describe("IČO of the supplier only (CRZ art_ico). Do not combine with `ico`."),
            ico_objednavatel: z.string().optional().describe("IČO of the contracting authority only (CRZ art_ico1). Do not combine with `ico`."),
            rezort: z.string().optional().describe("Government ministry / department."),
            limit: looseNumber(z.number().int().min(1).max(200)).optional().describe("Max contracts to return (default 20, max 200)."),
        },
    }, async ({ q, dodavatel, objednavatel, ico, ico_dodavatel, ico_objednavatel, rezort, limit }) => {
        try {
            const r = await listRecent({ q, dodavatel, objednavatel, ico, ico_dodavatel, ico_objednavatel, rezort }, limit ?? 20);
            return jsonContent({ count: r.results.length, ...r });
        }
        catch (e) {
            return errorContent(e);
        }
    });
    // crz_whats_new ---------------------------------------------------
    server.registerTool("crz_whats_new", {
        title: "Check for new CRZ contracts since a watermark",
        description: "Return contracts published since a previous check. Prefer `since_date` (the `max_datum` of the previous check; dedupe by id on your side): CRZ is ordered by publication date, so the scan stops deterministically and `complete: true` means every match was seen. `since_id` additionally excludes ids ≤ since_id; used alone it is only a heuristic (ids are not issued in publication order) and the result is never marked complete. `truncated: true` means `max_pages` was hit before reaching older contracts — the answer is incomplete, NOT \"nothing new\". Returns `max_datum` and `max_id` of the returned rows plus `warnings`.",
        inputSchema: {
            since_id: z.string().optional().describe("Highest CRZ contract id already seen (from a previous `max_id`). Rows with id ≤ since_id are excluded."),
            since_date: z.string().optional().describe("Only contracts published on/after this date (YYYY-MM-DD; DD.MM.YYYY also accepted). Recommended watermark: the previous `max_datum`."),
            q: z.string().optional().describe("Contract title fragment (CRZ field \"Názov zmluvy\")."),
            dodavatel: z.string().optional().describe("Supplier name fragment."),
            objednavatel: z.string().optional().describe("Contracting authority name fragment."),
            ico: z.string().optional().describe("IČO of either party: CRZ is queried both as supplier (art_ico) and as contracting authority (art_ico1) and the rows are merged; each row says where it matched in `ico_zhoda`."),
            ico_dodavatel: z.string().optional().describe("IČO of the supplier only (CRZ art_ico). Do not combine with `ico`."),
            ico_objednavatel: z.string().optional().describe("IČO of the contracting authority only (CRZ art_ico1). Do not combine with `ico`."),
            rezort: z.string().optional().describe("Government ministry / department."),
            max_pages: looseNumber(z.number().int().min(1).max(50)).optional().describe("Safety bound on pages (20 rows each) to scan back per query (default 10 = 200 rows; with `ico` the bound applies to each side). Hitting it sets `truncated: true`."),
        },
    }, async ({ since_id, since_date, q, dodavatel, objednavatel, ico, ico_dodavatel, ico_objednavatel, rezort, max_pages }) => {
        try {
            const r = await whatsNew({ sinceId: since_id, sinceDate: since_date }, { filters: { q, dodavatel, objednavatel, ico, ico_dodavatel, ico_objednavatel, rezort }, maxPages: max_pages });
            return jsonContent({ count: r.results.length, ...r });
        }
        catch (e) {
            return errorContent(e);
        }
    });
    // crz_get_contract ------------------------------------------------
    server.registerTool("crz_get_contract", {
        title: "Get CRZ contract metadata",
        description: "Fetch full parsed metadata for a single CRZ contract by id: parties with IČO, dates, prices, attachments, `predmet` (Popis predmetu zmluvy), `poznamka`, `verejne_obstaravanie_url` (ÚVO link). Rows the parser does not recognize are kept in `ine_polia` and listed in `warnings`.",
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
        description: "Heuristically split a contract into standard Slovak clause categories (Predmet, Cena, Platobné podmienky, Sankcie, Doba a ukončenie, Rozhodné právo, Záverečné ustanovenia, Prílohy) by article headings (\"Článok I.\" + title). Bodies are verbatim text. A missing category does NOT mean the contract lacks that clause — read `warnings` (unrecognized structure, empty or scanned attachments, phrases found outside a recognized heading) and `ostatne`. With `id`, only the attachment text is analysed.",
        inputSchema: {
            id: z.string().optional().describe("CRZ contract id (numeric, passed as string) — fetched & converted automatically."),
            markdown: z.string().optional().describe("Raw Markdown / plain text to analyse instead of fetching."),
        },
    }, async ({ id, markdown }) => {
        try {
            if (!id && !markdown)
                throw new Error("Provide either `id` or `markdown`.");
            if (markdown)
                return jsonContent(extractClauses(markdown));
            const r = await contractToMarkdown(id);
            // Analyse the contract text only; the metadata header is not a clause.
            const text = r.attachments
                .filter((a) => !hasNoContractText(a.markdown))
                .map((a) => `## Príloha: ${a.name}\n\n${a.markdown}`)
                .join("\n\n");
            const result = extractClauses(text);
            const attachmentWarnings = r.attachments.flatMap((a) => a.warnings.map((w) => `attachment ${a.file_id} (${a.name}): ${w}`));
            if (r.attachments.length === 0)
                attachmentWarnings.push("no_attachments: the contract has no attachment in CRZ, so there is no text to analyse.");
            result.warnings = [...attachmentWarnings, ...result.warnings];
            return jsonContent(result);
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
            const r = await findSimilarDetailed({ id, parties: { dodavatel, objednavatel }, keywords }, limit ?? 10);
            return jsonContent({ count: r.results.length, results: r.results, warnings: r.warnings });
        }
        catch (e) {
            return errorContent(e);
        }
    });
    return server;
}
//# sourceMappingURL=server.js.map