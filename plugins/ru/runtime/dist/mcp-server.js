import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RuClient } from "./ru-client.js";
import { RuMcpError, ruGetByIcoInputSchema, ruSearchInputSchema, ruGetCaseInputSchema, } from "./types.js";
import { publicRuError, safeLogEvent } from "./redaction.js";
/** ru_get_by_ico asks for every proceeding of one entity, so it takes the widest page. */
const GET_BY_ICO_PAGE_SIZE = 100;
export const MCP_TOOL_LIMITS = Object.freeze({
    maxCalls: 60,
    windowMs: 10 * 60 * 1_000,
    concurrency: 4,
});
export class McpToolInvocationGate {
    nowMs;
    attempts = [];
    active = 0;
    constructor(nowMs = Date.now) {
        this.nowMs = nowMs;
    }
    async run(operation) {
        const now = this.nowMs();
        const cutoff = now - MCP_TOOL_LIMITS.windowMs;
        this.attempts = this.attempts.filter((timestamp) => timestamp > cutoff);
        if (this.attempts.length >= MCP_TOOL_LIMITS.maxCalls) {
            throw new RuMcpError("RU_INTERNAL", "RU MCP tool rate limit exceeded.");
        }
        this.attempts.push(now);
        if (this.active >= MCP_TOOL_LIMITS.concurrency) {
            throw new RuMcpError("RU_INTERNAL", "RU MCP tool concurrency limit exceeded.");
        }
        this.active += 1;
        try {
            return await operation();
        }
        finally {
            this.active -= 1;
        }
    }
}
/**
 * Shape the ru_get_by_ico payload.
 *
 * `count` must describe the proceedings actually returned. It used to read
 * `result.pocetVysledkov`, which the AJAX partial response does not carry, so it
 * was null and `count` fell back to 0 — a company in konkurz reported
 * `count: 0` alongside a non-empty `konania`, and a caller trusting `count`
 * would clear a debtor that is demonstrably in bankruptcy.
 */
export function shapeGetByIcoResult(ico, result) {
    if (!/^[0-9]{8}$/.test(ico))
        throw new RuMcpError("RU_INPUT", "IČO must contain exactly eight ASCII digits.");
    const returned = result.results ?? [];
    const exactMatches = returned.filter((row) => (row.ico ?? "").replace(/\s+/g, "") === ico);
    const nonExactMatches = returned.filter((row) => (row.ico ?? "").replace(/\s+/g, "") !== ico);
    const sourceTotal = "pocetVysledkov" in result ? result.pocetVysledkov ?? null : null;
    return {
        ok: true,
        ico,
        count: exactMatches.length,
        returnedCount: returned.length,
        exactMatches,
        nonExactMatches,
        konania: exactMatches,
        sourceValidated: true,
        sourceTotal,
        truncated: sourceTotal !== null && sourceTotal > returned.length,
    };
}
export function createRuMcpServer(client = new RuClient(), options = {}) {
    const invocationGate = options.invocationGate ?? new McpToolInvocationGate();
    const server = new McpServer({
        name: "register-upadcov-mcp",
        version: "0.1.0",
    });
    server.registerTool("ru_search", {
        title: "RU Search",
        description: "Vyhľadanie insolvenčných / konkurzných / oddlženie konaní v Registri úpadcov (REPLIK, MS SR) podľa mena dlžníka, obchodného mena, IČO alebo spisovej značky. " +
            "Vracia objekt s poľami `query`, `pocetVysledkov`, `page`, `pageSize` a `results`. " +
            "Každý riadok `results` obsahuje iba `konanieId`, `debtorName`, `birthDate`, `ico`, `subjectType`, " +
            "`proceedingType`, `spisovaZnacka`, `spravca` a `detailUrl`. " +
            "Stránkovanie je nulované od nuly (`page` 0 je prvá strana; predvolený `pageSize` je 15). " +
            "Pole `konanieId` použi v ru_get_case na získanie detailu konania.",
        inputSchema: ruSearchInputSchema,
    }, async (args) => {
        try {
            return toTextResult(await invocationGate.run(() => client.search({
                query: args.query,
                page: args.page,
                pageSize: args.pageSize,
            })));
        }
        catch (error) {
            return toToolErrorResult(error);
        }
    });
    server.registerTool("ru_get_case", {
        title: "RU Case Detail",
        description: "Detail jedného konania podľa `konanieId` z výsledku ru_search. " +
            "Vracia iba top-level polia `konanieId`, `spisovaZnacka`, `typKonania`, `subjectType`, `upadca`, `sud`, " +
            "`odvolaciSud`, `sudca`, `spravca`, `stavKonania`, `historiaStavov`, `poslednyVerejnyOznam`, " +
            "`navrhovatelia`, `lehoty`, `typPodlaUzemnejPlatnosti`, `tabCounts` a `detailUrl`. " +
            "Objekt `upadca` obsahuje meno, dátum narodenia, IČO a adresu; `spravca` môže obsahovať dátum ustanovenia. " +
            "`tabCounts` sú iba počítadlá záložiek, nie obsah pohľadávok, majetku, schôdzí ani zoznamu veriteľov.",
        inputSchema: ruGetCaseInputSchema,
    }, async (args) => {
        try {
            return toTextResult(await invocationGate.run(() => client.getCase(args.konanieId)));
        }
        catch (error) {
            return toToolErrorResult(error);
        }
    });
    // -- ru_get_by_ico --------------------------------------------------------
    server.registerTool("ru_get_by_ico", {
        title: "RU Get by IČO",
        description: "Presné osemciferné vyhľadanie IČO ako wrapper nad ru_search. " +
            "Vracia polia `ok`, `ico`, `count`, `returnedCount`, `exactMatches`, `nonExactMatches`, `konania`, " +
            "`sourceValidated`, `sourceTotal` a `truncated`. `konania` je kompatibilný alias iba pre `exactMatches`; " +
            "riadky v oboch skupinách majú rovnaký tvar ako výsledok ru_search. " +
            "Pre dostupné detailné polia použi ru_get_case s `konanieId`.",
        inputSchema: ruGetByIcoInputSchema,
    }, async (args) => {
        try {
            const result = await invocationGate.run(() => client.search({ query: args.ico, pageSize: GET_BY_ICO_PAGE_SIZE }));
            return toTextResult(shapeGetByIcoResult(args.ico, result));
        }
        catch (error) {
            return toToolErrorResult(error);
        }
    });
    return server;
}
export function toTextResult(payload) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(payload, null, 2),
            },
        ],
    };
}
export function toToolErrorResult(error) {
    const publicError = publicRuError(error);
    safeLogEvent("tool_failed", { errorCode: publicError.code });
    return {
        ...toTextResult({ ok: false, error: publicError }),
        isError: true,
    };
}
