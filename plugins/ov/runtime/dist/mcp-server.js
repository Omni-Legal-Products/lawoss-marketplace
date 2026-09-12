import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import packageJson from "../package.json" with { type: "json" };
import { looseNumber } from "./scalars.js";
import { DEFAULT_OV_BASE_URL, MAX_PAGES, MAX_ROWS, MAX_TEXT_FIELD_BYTES, OvClient, OvSourceError, } from "./ov-client.js";
import { createRequestRateLimiter } from "./rate-limiter.js";
import { safeError, safeLog } from "./redaction.js";
import { ovGetNoticeInputSchema, ovSearchInputSchema } from "./types.js";
const ovGetByIcoInputSchema = {
    ico: z.string().min(1).max(32),
    limit: looseNumber(z.number().int().min(1).max(MAX_ROWS)).optional(),
};
function parseToolInput(shape, value) {
    const parsed = z.object(shape).safeParse(value);
    if (!parsed.success)
        throw new OvSourceError("OV_INPUT", "OV tool input is invalid.");
    return parsed.data;
}
/** Zdroj podporuje iba 10/20/50/100 na stranu; vyber najmenšiu, čo limit pokryje. */
export function pageSizeFor(limit) {
    if (limit <= 10)
        return 10;
    if (limit <= 20)
        return 20;
    if (limit <= 50)
        return 50;
    return 100;
}
export function createOvMcpServer(options = {}) {
    const client = options.client ?? new OvClient();
    const now = options.now ?? (() => new Date());
    const rateLimiter = options.rateLimiter ?? createRequestRateLimiter();
    const rateLimitKey = options.rateLimitKey ?? "stdio";
    const server = new McpServer({ name: "obchodny-vestnik-mcp", version: packageJson.version });
    normalizeSdkInputErrors(server);
    const guard = () => {
        const decision = rateLimiter.check(rateLimitKey, "mcp");
        if (!decision.allowed)
            throw new OvSourceError("OV_HTTP", "MCP request rate limit exceeded.");
    };
    server.registerTool("ov_search", {
        title: "OV Search",
        description: "Vyhľadá verejné oznámenia v oficiálnom zdroji Obchodného vestníka. Výsledok je technický výpis verejného zdroja, nie právny záver; truncated a warnings určujú limity úplnosti.",
        inputSchema: ovSearchInputSchema,
    }, async (rawArgs) => {
        try {
            guard();
            const args = parseToolInput(ovSearchInputSchema, rawArgs);
            validateSearchArgs(args);
            return toTextResult(searchEnvelope(await client.search(args), now()));
        }
        catch (error) {
            return formatToolError(error);
        }
    });
    server.registerTool("ov_get_notice", {
        title: "OV Notice Detail",
        description: "Načíta PDF detail jedného verejného oznámenia z oficiálneho zdroja podľa idFormular. Text je obmedzený a sourceUrl je kanonická verejná adresa.",
        inputSchema: ovGetNoticeInputSchema,
    }, async (rawArgs) => {
        try {
            guard();
            const args = parseToolInput(ovGetNoticeInputSchema, rawArgs);
            if (!Number.isSafeInteger(args.idFormular) || args.idFormular < 1)
                throw new OvSourceError("OV_INPUT", "IdFormular is invalid.");
            return toTextResult(noticeEnvelope(await client.getNotice(args.idFormular), now()));
        }
        catch (error) {
            return formatToolError(error);
        }
    });
    server.registerTool("ov_get_by_ico", {
        title: "OV Get by IČO",
        description: "Stránkuje verejné oznámenia podľa presne osemmiestneho IČO. Najviac 20 strán a 2 000 riadkov; truncated vždy oznamuje, že zdroj môže obsahovať ďalšie výsledky.",
        inputSchema: ovGetByIcoInputSchema,
    }, async (rawArgs) => {
        try {
            guard();
            const args = parseToolInput(ovGetByIcoInputSchema, rawArgs);
            if (!/^\d{8}$/.test(args.ico))
                throw new OvSourceError("OV_INPUT", "IČO is invalid.");
            return toTextResult(await byIcoEnvelope(client, args.ico, args.limit ?? 50, now));
        }
        catch (error) {
            return formatToolError(error);
        }
    });
    return server;
}
function normalizeSdkInputErrors(server) {
    const internal = server;
    const fallback = internal.createToolError.bind(server);
    internal.createToolError = (message) => {
        const isOvInputFailure = /Input validation error: Invalid arguments for tool (?:ov_search|ov_get_notice|ov_get_by_ico):/.test(message);
        return isOvInputFailure ? formatToolError(new OvSourceError("OV_INPUT", "OV tool input is invalid.")) : fallback(message);
    };
}
function validateSearchArgs(args) {
    if ([args.name, args.keywords, args.mark, args.seat].some((value) => value !== undefined && !value.trim())) {
        throw new OvSourceError("OV_INPUT", "OV search input is invalid.");
    }
    if (!args.name && !args.ico && !args.keywords && !args.mark && !args.seat && !args.kapitola && !args.kapitolaGroup) {
        throw new OvSourceError("OV_INPUT", "OV search criterion is required.");
    }
}
function searchEnvelope(result, retrievedAt) {
    const rows = result.rows.map(sanitizeRow);
    const sourceTotal = result.sourceTotal === null ? null : boundedCount(result.sourceTotal, rows.length);
    return {
        ok: true,
        source: "OV",
        retrievedAt: retrievedAt.toISOString(),
        sourceValidated: true,
        rows,
        returnedCount: rows.length,
        sourceTotal,
        page: boundedPage(result.page),
        pageSize: pageSizeFor(result.countOnPage),
        truncated: Boolean(result.truncated),
        truncationReason: result.truncated ? boundedString(result.truncationReason ?? "source_has_more_rows") : null,
        kapitolaDetail: (result.kapitolyDetail ?? []).map((entry) => ({
            kapitola: boundedString(entry.kapitola),
            label: boundedString(entry.label),
            rowCount: boundedCount(entry.rowCount, 0),
            newest: entry.newest === null ? null : boundedString(entry.newest),
        })),
        warnings: (result.warnings ?? []).map((warning) => boundedString(warning)),
    };
}
function noticeEnvelope(detail, retrievedAt) {
    const sourceUrl = canonicalNoticeUrl(detail.sourceUrl, detail.idFormular);
    const subject = {
        ...(detail.subjekt.pravnaForma !== undefined ? { pravnaForma: boundedString(detail.subjekt.pravnaForma) } : {}),
        ...(detail.subjekt.nazov !== undefined ? { nazov: boundedString(detail.subjekt.nazov) } : {}),
        ...(detail.subjekt.sidlo !== undefined ? { sidlo: boundedString(detail.subjekt.sidlo) } : {}),
        ...(detail.subjekt.ico !== undefined ? { ico: boundedString(detail.subjekt.ico) } : {}),
    };
    const fields = Object.fromEntries(Object.entries(detail.polia).slice(0, 256).map(([key, value]) => [boundedString(key), boundedString(value)]));
    const notice = {
        idFormular: detail.idFormular,
        ...(detail.kodFormulara !== undefined ? { kodFormulara: boundedString(detail.kodFormulara) } : {}),
        ...(detail.nazovFormulara !== undefined ? { nazovFormulara: boundedString(detail.nazovFormulara) } : {}),
        ...(detail.cisloOV !== undefined ? { cisloOV: boundedString(detail.cisloOV) } : {}),
        ...(detail.denVydania !== undefined ? { denVydania: boundedString(detail.denVydania) } : {}),
        subjekt: subject,
        polia: fields,
        text: boundedString(detail.text, 128 * 1024),
        ...(detail.vydava !== undefined ? { vydava: boundedString(detail.vydava) } : {}),
        sourceUrl,
        sourceFormat: "application/pdf",
    };
    return { ok: true, source: "OV", retrievedAt: retrievedAt.toISOString(), sourceValidated: true, notice, warnings: [] };
}
async function byIcoEnvelope(client, ico, limit, now) {
    const requestedLimit = Math.min(limit, MAX_ROWS);
    const pageSize = pageSizeFor(Math.min(requestedLimit, 100));
    const rows = new Map();
    let sourceTotal = 0;
    let page = 1;
    let sourceComplete = false;
    while (page <= MAX_PAGES && rows.size < requestedLimit && rows.size < MAX_ROWS) {
        const result = await client.search({ ico, page, countOnPage: pageSize });
        sourceTotal = result.sourceTotal === null || sourceTotal === null
            ? null
            : Math.max(sourceTotal, boundedCount(result.sourceTotal, result.rows.length));
        for (const row of result.rows) {
            const safe = sanitizeRow(row);
            rows.set(safe.idFormular, safe);
            if (rows.size >= requestedLimit || rows.size >= MAX_ROWS)
                break;
        }
        sourceComplete = !result.truncated || result.rows.length === 0
            || (sourceTotal !== null && page * pageSize >= sourceTotal);
        if (sourceComplete)
            break;
        page += 1;
    }
    const notices = [...rows.values()].slice(0, requestedLimit);
    const truncated = !sourceComplete || (sourceTotal !== null && sourceTotal > notices.length);
    let truncationReason = null;
    if (truncated) {
        if (notices.length >= requestedLimit && (sourceTotal === null || sourceTotal > notices.length))
            truncationReason = "requested_limit";
        else if (page >= MAX_PAGES)
            truncationReason = "page_limit";
        else if (notices.length >= MAX_ROWS)
            truncationReason = "row_limit";
        else
            truncationReason = "source_has_more_rows";
    }
    return {
        ok: true,
        source: "OV",
        retrievedAt: now().toISOString(),
        sourceValidated: true,
        ico,
        notices,
        returnedCount: notices.length,
        truncated,
        truncationReason,
        warnings: [],
    };
}
function sanitizeRow(row) {
    if (!Number.isSafeInteger(row.idx) || row.idx < 1 || !Number.isSafeInteger(row.idFormular) || row.idFormular < 1) {
        throw new OvSourceError("OV_SCHEMA", "OV result row is invalid.");
    }
    const detailUrl = "/ObchodnyVestnik/Formular/FormularDetail.aspx?IdFormular=" + row.idFormular;
    if (row.detailUrl !== detailUrl)
        throw new OvSourceError("OV_SCHEMA", "OV result detail URL is invalid.");
    return {
        idx: row.idx,
        kapitola: boundedString(row.kapitola),
        subjekt: boundedString(row.subjekt),
        cisloOV: boundedString(row.cisloOV),
        znacka: boundedString(row.znacka),
        datumZverejnenia: boundedString(row.datumZverejnenia),
        idFormular: row.idFormular,
        detailUrl,
    };
}
function canonicalNoticeUrl(value, idFormular) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new OvSourceError("OV_SCHEMA", "OV notice source URL is invalid.");
    }
    const expected = new URL("/ObchodnyVestnik/Formular/FormularDetail.aspx?IdFormular=" + idFormular, DEFAULT_OV_BASE_URL);
    if (parsed.origin !== expected.origin || parsed.pathname !== expected.pathname || parsed.search !== expected.search || parsed.username || parsed.password || parsed.hash) {
        throw new OvSourceError("OV_SCHEMA", "OV notice source URL is invalid.");
    }
    return expected.href;
}
function boundedString(value, maximum = MAX_TEXT_FIELD_BYTES) {
    if (typeof value !== "string")
        throw new OvSourceError("OV_SCHEMA", "OV public field is invalid.");
    if (Buffer.byteLength(value, "utf8") <= maximum)
        return value;
    let output = value;
    while (Buffer.byteLength(output, "utf8") > maximum)
        output = output.slice(0, -1);
    return output;
}
function boundedCount(value, minimum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > Number.MAX_SAFE_INTEGER)
        throw new OvSourceError("OV_SCHEMA", "OV source count is invalid.");
    return value;
}
function boundedPage(value) {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGES)
        throw new OvSourceError("OV_SCHEMA", "OV source page is invalid.");
    return value;
}
export function toTextResult(payload) {
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}
export function formatToolError(error) {
    const safe = safeError(error);
    console.error(safeLog("ov_tool_failed", { code: safe.code }));
    return {
        content: [{ type: "text", text: JSON.stringify({ ok: false, code: safe.code, message: safe.message, warnings: [] }) }],
        isError: true,
    };
}
