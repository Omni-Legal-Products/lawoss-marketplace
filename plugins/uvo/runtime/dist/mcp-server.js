import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import packageJson from "../package.json" with { type: "json" };
import { looseNumber } from "./scalars.js";
import { DEFAULT_UVO_BASE_URL, MAX_PAGES, MAX_ROWS, MAX_TEXT_FIELD_BYTES, UvoClient, UvoSourceError } from "./uvo-client.js";
import { createRequestRateLimiter } from "./rate-limiter.js";
import { safeError, safeLog } from "./redaction.js";
import { uvoGetNoticeInputSchema, uvoSearchInputSchema } from "./types.js";
export function createUvoMcpServer(options = {}) {
    const client = options.client ?? new UvoClient();
    const canonicalOrigin = client.canonicalOrigin ?? DEFAULT_UVO_BASE_URL;
    const now = options.now ?? (() => new Date());
    const rateLimiter = options.rateLimiter ?? createRequestRateLimiter();
    const rateLimitKey = options.rateLimitKey ?? "stdio";
    const server = new McpServer({ name: "uvo-mcp", version: packageJson.version });
    installToolErrorBoundary(server);
    const guard = () => { const decision = rateLimiter.check(rateLimitKey, "mcp"); if (!decision.allowed)
        throw new UvoSourceError("UVO_HTTP", "MCP request rate limit exceeded."); };
    server.registerTool("uvo_search", {
        title: "UVO Search",
        description: "Vyhľadá verejné zákazky v oficiálnom zdroji ÚVO. Výsledok je technický výpis verejného zdroja, nie právny záver; truncated a warnings určujú limity úplnosti.",
        inputSchema: uvoSearchInputSchema,
    }, async (args) => {
        try {
            guard();
            validateSearchArgs(args);
            return toTextResult(searchEnvelope(await client.search(args), now(), canonicalOrigin));
        }
        catch (error) {
            return formatToolError(error);
        }
    });
    server.registerTool("uvo_get_notice", {
        title: "UVO Notice Detail",
        description: "Načíta verejný HTML detail oznámenia z oficiálneho zdroja ÚVO podľa číselného noticeId; sourceUrl je kanonická verejná adresa.",
        inputSchema: uvoGetNoticeInputSchema,
    }, async (args) => {
        try {
            guard();
            if (!/^[1-9]\d{0,15}$/.test(args.noticeId))
                throw new UvoSourceError("UVO_INPUT", "Notice identifier is invalid.");
            return toTextResult(noticeEnvelope(await client.getNotice(args.noticeId), now(), canonicalOrigin));
        }
        catch (error) {
            return formatToolError(error);
        }
    });
    server.registerTool("uvo_get_contracting_authority", {
        title: "UVO Contracting Authority",
        description: "Stránkuje verejné zákazky podľa presne osemmiestneho IČO. Najviac 20 strán a 2 000 riadkov; truncated vždy oznamuje, že zdroj môže obsahovať ďalšie výsledky.",
        inputSchema: {
            ico: z.string().min(1).max(32).describe("IČO, presne 8 ASCII číslic."),
            limit: looseNumber(z.number().int().min(1).max(MAX_ROWS)).optional().describe("Maximum vrátených riadkov, 1 až 2 000."),
        },
    }, async (args) => {
        try {
            guard();
            if (!/^\d{8}$/.test(args.ico))
                throw new UvoSourceError("UVO_INPUT", "IČO is invalid.");
            return toTextResult(await authorityEnvelope(client, args.ico, args.limit ?? 50, now, canonicalOrigin));
        }
        catch (error) {
            return formatToolError(error);
        }
    });
    return server;
}
function installToolErrorBoundary(server) {
    // The SDK validates registered Zod schemas before invoking our callbacks and
    // otherwise exposes its own non-JSON -32602 text. Keep the published schemas
    // strict while normalizing that outer protocol boundary into our safe result.
    const sdk = server;
    sdk.createToolError = (message) => formatToolError(new UvoSourceError(/Input validation error:\s+Invalid arguments for tool uvo_(?:search|get_notice|get_contracting_authority):/.test(message)
        ? "UVO_INPUT"
        : "UVO_HTTP", "MCP tool request failed."));
}
function validateSearchArgs(args) {
    const text = [args.authorityName, args.contractName, args.cpv, args.nuts];
    if (text.some((value) => value !== undefined && !value.trim()))
        throw new UvoSourceError("UVO_INPUT", "UVO search input is invalid.");
    if (args.ico !== undefined && !/^\d{8}$/.test(args.ico))
        throw new UvoSourceError("UVO_INPUT", "IČO is invalid.");
    if (!args.ico && !args.authorityName && !args.contractName && !args.cpv && !args.nuts)
        throw new UvoSourceError("UVO_INPUT", "UVO search criterion is required.");
}
function searchEnvelope(result, retrievedAt, canonicalOrigin) {
    const results = result.results.map((row) => sanitizeRow(row, canonicalOrigin));
    const resultCount = boundedCount(result.resultCount, results.length);
    const page = boundedPage(result.page ?? result.pagination.page);
    const pagination = sanitizePagination(result.pagination, page);
    const truncated = Boolean(result.truncated || pagination.hasNext || resultCount > results.length);
    return {
        ok: true, source: "UVO", retrievedAt: retrievedAt.toISOString(), sourceValidated: true,
        results, resultCount, pagination, page, pageSize: boundedPageSize(result.pageSize), truncated,
        truncationReason: truncated ? boundedString(result.truncationReason ?? "source_has_more_rows") : null,
        warnings: (result.warnings ?? []).map((warning) => boundedString(warning)),
    };
}
function noticeEnvelope(detail, retrievedAt, canonicalOrigin) {
    const authority = compact({
        name: optionalString(detail.contractingAuthority.name), ico: optionalString(detail.contractingAuthority.ico), address: optionalString(detail.contractingAuthority.address),
        nuts: optionalString(detail.contractingAuthority.nuts), country: optionalString(detail.contractingAuthority.country), email: optionalString(detail.contractingAuthority.email),
        url: optionalString(detail.contractingAuthority.url), authorityType: optionalString(detail.contractingAuthority.authorityType), mainActivity: optionalString(detail.contractingAuthority.mainActivity),
    });
    const estimated = detail.subject.estimatedValue;
    if (estimated && estimated.amount !== null && !Number.isFinite(estimated.amount))
        throw new UvoSourceError("UVO_SCHEMA", "UVO estimated value is invalid.");
    const subject = compact({
        title: optionalString(detail.subject.title), referenceNumber: optionalString(detail.subject.referenceNumber), mainCpv: optionalString(detail.subject.mainCpv),
        additionalCpv: detail.subject.additionalCpv.slice(0, 256).map((value) => boundedString(value)), shortDescription: optionalString(detail.subject.shortDescription),
        estimatedValue: estimated ? { amount: estimated.amount, currency: estimated.currency === null ? null : boundedString(estimated.currency), vat: estimated.vat === null ? null : boundedString(estimated.vat) } : undefined,
        placeNuts: optionalString(detail.subject.placeNuts),
    });
    const notice = compact({
        noticeId: validateNoticeId(detail.noticeId), noticeCode: optionalString(detail.noticeCode), vestnikNumber: optionalString(detail.vestnikNumber),
        publishedDate: optionalString(detail.publishedDate), noticeType: optionalString(detail.noticeType), procedureType: optionalString(detail.procedureType), contractType: optionalString(detail.contractType),
        contractingAuthority: authority, subject, relatedZakazkaId: optionalString(detail.relatedZakazkaId), sourceUrl: canonicalNoticeUrl(detail.sourceUrl, detail.noticeId, canonicalOrigin),
    });
    return { ok: true, source: "UVO", retrievedAt: retrievedAt.toISOString(), sourceValidated: true, notice, warnings: [] };
}
async function authorityEnvelope(client, ico, limit, now, canonicalOrigin) {
    const requestedLimit = Math.min(limit, MAX_ROWS);
    const rows = new Map();
    let page = 1;
    let sourceCount = 0;
    let sourceComplete = false;
    let pagination = { page: 1, hasNext: false, nextParam: null };
    while (page <= MAX_PAGES && rows.size < requestedLimit && rows.size < MAX_ROWS) {
        const result = await client.search({ ico, page });
        sourceCount = Math.max(sourceCount, boundedCount(result.resultCount, result.results.length));
        pagination = sanitizePagination(result.pagination, page);
        for (const row of result.results) {
            const safe = sanitizeRow(row, canonicalOrigin);
            rows.set(safe.zakazkaId, safe);
            if (rows.size >= requestedLimit || rows.size >= MAX_ROWS)
                break;
        }
        sourceComplete = !pagination.hasNext && sourceCount <= rows.size;
        if (sourceComplete || !pagination.hasNext)
            break;
        page += 1;
    }
    const contracts = [...rows.values()].slice(0, requestedLimit);
    const truncated = !sourceComplete || sourceCount > contracts.length;
    let truncationReason = null;
    if (truncated) {
        if (contracts.length >= requestedLimit && (!sourceComplete || sourceCount > contracts.length))
            truncationReason = "requested_limit";
        else if (page >= MAX_PAGES)
            truncationReason = "page_limit";
        else if (contracts.length >= MAX_ROWS)
            truncationReason = "row_limit";
        else
            truncationReason = "source_has_more_rows";
    }
    return { ok: true, source: "UVO", retrievedAt: now().toISOString(), sourceValidated: true, ico, contracts, contractCount: sourceCount, pagination, returnedCount: contracts.length, truncated, truncationReason, warnings: [] };
}
function sanitizeRow(row, canonicalOrigin) {
    if (!/^\d+$/.test(row.zakazkaId) || (row.authorityProfileId && !/^\d+$/.test(row.authorityProfileId)))
        throw new UvoSourceError("UVO_SCHEMA", "UVO result identifier is invalid.");
    let url;
    try {
        url = new URL(row.detailUrl);
    }
    catch {
        throw new UvoSourceError("UVO_SCHEMA", "UVO result detail URL is invalid.");
    }
    const expectedPath = `/vyhladavanie/vyhladavanie-zakaziek/detail/${row.zakazkaId}`;
    if (url.origin !== canonicalOrigin || url.pathname !== expectedPath || url.username || url.password || url.hash || [...url.searchParams.keys()].some((key) => key !== "cHash"))
        throw new UvoSourceError("UVO_SCHEMA", "UVO result detail URL is invalid.");
    return { zakazkaId: row.zakazkaId, detailUrl: url.href, title: boundedString(row.title), authorityName: boundedString(row.authorityName), authorityProfileId: boundedString(row.authorityProfileId), mainCpvLabel: boundedString(row.mainCpvLabel), nutsLabel: boundedString(row.nutsLabel), updated: boundedString(row.updated), source: boundedString(row.source) };
}
function canonicalNoticeUrl(value, noticeId, canonicalOrigin) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new UvoSourceError("UVO_SCHEMA", "UVO notice source URL is invalid.");
    }
    const expected = new URL(`/vestnik-a-registre/vestnik/oznamenie/detail/${validateNoticeId(noticeId)}`, canonicalOrigin);
    if (parsed.origin !== expected.origin || parsed.pathname !== expected.pathname || parsed.search || parsed.hash || parsed.username || parsed.password)
        throw new UvoSourceError("UVO_SCHEMA", "UVO notice source URL is invalid.");
    return expected.href;
}
function sanitizePagination(value, expectedPage) {
    if (value.page !== expectedPage || typeof value.hasNext !== "boolean")
        throw new UvoSourceError("UVO_SCHEMA", "UVO pagination is invalid.");
    const nextParam = value.nextParam;
    if ((value.hasNext && nextParam !== `pageNo=${expectedPage + 1}`) || (!value.hasNext && nextParam !== null))
        throw new UvoSourceError("UVO_SCHEMA", "UVO pagination is invalid.");
    return { page: expectedPage, hasNext: value.hasNext, nextParam };
}
function validateNoticeId(value) { if (!/^[1-9]\d{0,15}$/.test(value))
    throw new UvoSourceError("UVO_SCHEMA", "UVO notice identifier is invalid."); return value; }
function boundedString(value) { if (typeof value !== "string")
    throw new UvoSourceError("UVO_SCHEMA", "UVO public field is invalid."); if (Buffer.byteLength(value, "utf8") <= MAX_TEXT_FIELD_BYTES)
    return value; let out = value; while (Buffer.byteLength(out, "utf8") > MAX_TEXT_FIELD_BYTES)
    out = out.slice(0, -1); return out; }
function optionalString(value) { return value === undefined ? undefined : boundedString(value); }
function boundedCount(value, minimum) { if (!Number.isSafeInteger(value) || value < minimum)
    throw new UvoSourceError("UVO_SCHEMA", "UVO source count is invalid."); return value; }
function boundedPage(value) { if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGES)
    throw new UvoSourceError("UVO_SCHEMA", "UVO source page is invalid."); return value; }
function boundedPageSize(value) { if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ROWS)
    throw new UvoSourceError("UVO_SCHEMA", "UVO source page size is invalid."); return value; }
function compact(value) { return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)); }
export function toTextResult(payload) { return { content: [{ type: "text", text: JSON.stringify(payload) }] }; }
export function formatToolError(error) { const safe = safeError(error); console.error(safeLog("uvo_tool_failed", { code: safe.code })); return { content: [{ type: "text", text: JSON.stringify({ ok: false, code: safe.code, message: safe.message, warnings: [] }) }], isError: true }; }
