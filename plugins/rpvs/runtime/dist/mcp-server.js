import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RpvsClient } from "./rpvs-client.js";
import { bulkLookupInputSchema, getPartnerInputSchema, searchInputSchema } from "./types.js";
import { withHistory } from "./history.js";
import { publicError, safeLogEvent } from "./redaction.js";
export const SERVER_VERSION = "0.2.0";
export function createRpvsMcpServer() {
    const client = new RpvsClient();
    const server = new McpServer({
        name: "rpvs-mcp",
        version: SERVER_VERSION,
    });
    server.registerTool("rpvs_search", {
        title: "RPVS Search",
        description: "Vyhladanie partnerov verejneho sektora v RPVS podla obchodneho mena (nazvu) alebo ICO. " +
            "Pri 'auto' rezime sa cislicovy vstup povazuje za ICO. Vracia zoznam zaznamov vratane historie platnosti. " +
            "Vysledok je orezany na 'limit' (default 20); 'truncated: true' hovori, ze register mal dalsie zhody, " +
            "takze orezany zoznam nemozno citat ako uplnu odpoved.",
        inputSchema: searchInputSchema,
    }, async (args) => {
        try {
            const { results, truncated, limit } = await client.search(args.query, {
                by: args.by,
                match: args.match,
                limit: args.limit,
            });
            return toTextResult({
                query: args.query,
                count: results.length,
                limit,
                truncated,
                results,
                ...(truncated
                    ? {
                        note: `Register má viac než ${limit} zhôd; vrátených je prvých ${results.length}. ` +
                            "Zvýš limit, alebo dopyt zúž (match: 'startswith', alebo hľadaj podľa IČO).",
                    }
                    : {}),
            });
        }
        catch (error) {
            return toErrorResult("rpvs_search", error);
        }
    });
    server.registerTool("rpvs_get_partner", {
        title: "RPVS Partner Detail (UBO chain)",
        description: "Plny detail partnera verejneho sektora podla ICO (odporucane) alebo Id/cisla vlozky: " +
            "konecni uzivatelia vyhod (KUV/UBO) vratane historie platnosti, opravnene osoby, verejni funkcionari, " +
            "kvalifikovane podnety (sankcne konania) a metadata verifikacnych dokumentov. Read-only. " +
            "Historicke zaznamy (ubos.all, authorizedPersons.all, partnerHistory) sa vracaju len s includeHistory: true; " +
            "inak zostane historyCount a priznak historyOmitted, takze skrateny vystup nemozno citat ako partnera bez historie.",
        inputSchema: getPartnerInputSchema,
    }, async (args) => {
        try {
            const hasIco = args.ico !== undefined;
            const hasPartnerId = args.partnerId !== undefined;
            if (hasIco === hasPartnerId) {
                return toErrorResult("rpvs_get_partner", new Error("INVALID_INPUT"));
            }
            const includeVerifications = args.includeVerifications ?? true;
            let detail;
            if (hasIco) {
                detail = await client.getPartnerByIco(args.ico, includeVerifications);
            }
            else if (args.partnerId !== undefined) {
                detail = await client.getPartnerById(args.partnerId, includeVerifications);
            }
            if (!detail) {
                return toErrorResult("rpvs_get_partner", new Error("NOT_FOUND"));
            }
            return toTextResult(withHistory(detail, args.includeHistory ?? false));
        }
        catch (error) {
            return toErrorResult("rpvs_get_partner", error);
        }
    });
    // -- rpvs_bulk_lookup -----------------------------------------------------
    server.registerTool("rpvs_bulk_lookup", {
        title: "RPVS Bulk Lookup",
        description: "Vyhľadanie viacerých partnerov verejného sektora naraz podľa zoznamu IČO. " +
            "Užitočné pre batch due-diligence — napr. overenie zoznamu dodávateľov, " +
            "účastníkov obstarávania, alebo konečných užívateľov výhod (KUV/UBO) " +
            "z externého zdroja. " +
            "Vracia zoznam s položkami: ico, nazov, platnost_od, platnost_do, " +
            "status (found/not_found). " +
            "Pre plný detail s UBO reťazcom použi rpvs_get_partner na konkrétne IČO. " +
            "Limit: max 20 IČO naraz (ochrana pred rate-limitom).",
        inputSchema: bulkLookupInputSchema,
    }, async (args) => {
        try {
            const results = [];
            for (const ico of args.icoList) {
                try {
                    const { results: matches } = await client.search(ico, { by: "ico", limit: 1 });
                    if (matches.length > 0) {
                        const first = matches[0];
                        results.push({
                            ico,
                            status: "found",
                            nazov: first.name,
                            platnost_od: first.validFrom,
                            platnost_do: first.validTo,
                            partnerId: first.id,
                        });
                    }
                    else {
                        results.push({ ico, status: "not_found" });
                    }
                }
                catch (err) {
                    results.push({
                        index: results.length,
                        status: "error",
                        error: publicError(err),
                    });
                }
            }
            return toTextResult({
                ok: true,
                requested: args.icoList.length,
                found: results.filter((r) => r.status === "found").length,
                results,
            });
        }
        catch (error) {
            return toErrorResult("rpvs_bulk_lookup", error);
        }
    });
    return server;
}
export function toTextResult(payload) {
    const provenance = {
        source: "RPVS Open Data API",
        fetchedAt: new Date().toISOString(),
        freshnessCaveat: "This is a point-in-time public-register snapshot; verify the current RPVS record and underlying documents before relying on it.",
    };
    const output = payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? { ...payload, ...provenance }
        : { data: payload, ...provenance };
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(output, null, 2),
            },
        ],
    };
}
export function toErrorResult(operation, error) {
    const safe = publicError(error);
    safeLogEvent("tool_error", { route: operation, errorCode: safe.code });
    return {
        isError: true,
        content: [{
                type: "text",
                text: JSON.stringify({ ok: false, operation, ...safe }),
            }],
    };
}
