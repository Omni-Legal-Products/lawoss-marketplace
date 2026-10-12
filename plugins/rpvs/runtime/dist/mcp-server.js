import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RpvsClient } from "./rpvs-client.js";
import { bulkLookupInputSchema, getPartnerInputSchema, searchInputSchema } from "./types.js";
import { withHistory } from "./history.js";
import { publicError, safeLogEvent } from "./redaction.js";
export const SERVER_VERSION = "0.3.0";
export function createRpvsMcpServer() {
    const client = new RpvsClient();
    const server = new McpServer({
        name: "rpvs-mcp",
        version: SERVER_VERSION,
    });
    server.registerTool("rpvs_search", {
        title: "RPVS Search",
        description: "Vyhladanie partnerov verejneho sektora v RPVS podla obchodneho mena (nazvu), priezviska fyzickej osoby alebo ICO. " +
            "Meno sa porovnava bez ohladu na velkost pismen, diakritika sa vsak musi zhodovat. " +
            "Pri 'auto' rezime sa cislicovy vstup povazuje za ICO. Vracia zoznam zaznamov vratane historie platnosti. " +
            "Pole 'id' je Id zaznamu PVS; pre rpvs_get_partner pouzi 'partnerId' (alebo 'insertNumber' ako insertNumber). " +
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
        description: "Plny detail partnera verejneho sektora podla ICO (odporucane), partnerId (Partneri.Id) alebo insertNumber " +
            "(cislo vlozky z webu RPVS): konecni uzivatelia vyhod (KUV/UBO) vratane historie platnosti, opravnene osoby, " +
            "verejni funkcionari, kvalifikovane podnety (sankcne konania; decisionCode je nedekodovany kod zdroja), " +
            "vymaz (deletion), pokuta (fine), datum overenia identifikacie KUV (uboIdentityVerification.verifiedOn) " +
            "a metadata verifikacnych dokumentov. Read-only. " +
            "Ak ma ICO viac registracii (vloziek), vyberie sa aktivna, inak naposledy ukoncena; vsetky su v 'registrations'. " +
            "'incompleteCollections' znamena, ze kolekcia nie je uplna a zoznam nemozno citat ako uplny. " +
            "Historicke zaznamy (ubos.all, authorizedPersons.all, partnerHistory) sa vracaju len s includeHistory: true; " +
            "inak zostane historyCount a priznak historyOmitted, takze skrateny vystup nemozno citat ako partnera bez historie.",
        inputSchema: getPartnerInputSchema,
    }, async (args) => {
        try {
            const given = [args.ico, args.partnerId, args.insertNumber].filter((v) => v !== undefined).length;
            if (given !== 1) {
                return toErrorResult("rpvs_get_partner", new Error("INVALID_INPUT"));
            }
            const includeVerifications = args.includeVerifications ?? true;
            let detail;
            if (args.ico !== undefined) {
                detail = await client.getPartnerByIco(args.ico, includeVerifications);
            }
            else if (args.partnerId !== undefined) {
                detail = await client.getPartnerById(args.partnerId, includeVerifications);
            }
            else if (args.insertNumber !== undefined) {
                detail = await client.getPartnerByInsertNumber(args.insertNumber, includeVerifications);
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
            "Vracia zoznam s položkami: ico, status (found/not_found/error), nazov, platnost_od a platnost_do " +
            "aktuálneho (inak posledného) záznamu, aktivny, vymaz (dátum a dôvod výmazu alebo null), " +
            "partnerId (Partneri.Id pre rpvs_get_partner), cislo_vlozky, pvsRecordId a pocet_registracii. " +
            "Pri viacerých registráciách pod jedným IČO hlási aktívnu, inak naposledy ukončenú. " +
            "Pre plný detail s UBO reťazcom použi rpvs_get_partner na konkrétne IČO. " +
            "Limit: max 20 IČO naraz (ochrana pred rate-limitom).",
        inputSchema: bulkLookupInputSchema,
    }, async (args) => {
        try {
            const results = [];
            for (const ico of args.icoList) {
                try {
                    const regs = await client.resolveIco(ico);
                    const chosen = regs.find((r) => r.registration.selected);
                    if (chosen) {
                        const { registration, latest } = chosen;
                        results.push({
                            ico,
                            status: "found",
                            nazov: latest?.name ?? null,
                            platnost_od: latest?.validFrom ?? null,
                            platnost_do: latest?.validTo ?? null,
                            aktivny: registration.active,
                            vymaz: registration.deletion
                                ? {
                                    datum: registration.deletion.date,
                                    dovod: registration.deletion.reason,
                                    poznamka: registration.deletion.note,
                                }
                                : null,
                            partnerId: registration.partnerId,
                            cislo_vlozky: registration.insertNumber,
                            pvsRecordId: latest?.id ?? null,
                            pocet_registracii: regs.length,
                        });
                    }
                    else {
                        results.push({ ico, status: "not_found" });
                    }
                }
                catch (err) {
                    results.push({
                        ico,
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
