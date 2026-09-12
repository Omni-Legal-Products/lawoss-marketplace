import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { capResults, DEFAULT_SEARCH_LIMIT } from "./ranking.js";
import { looseBoolean, looseNumber } from "./scalars.js";
import { RpoClient, RpoApiError, normalizeSearch, toDetailView, toRelatedView, } from "./rpo-client.js";
import { redactToolInput, safeErrorClass, safeOperationalLog } from "./redaction.js";
export function createRpoMcpServer() {
    const client = new RpoClient();
    const server = new McpServer({
        name: "rpo-mcp",
        version: "0.1.0",
    });
    // -- rpo_search ----------------------------------------------------------
    const searchInputSchema = {
        fullName: z.string().min(1).optional(),
        identifier: z.string().min(1).optional(),
        onlyActive: looseBoolean().optional(),
        addressMunicipality: z.string().min(1).optional(),
        addressStreet: z.string().min(1).optional(),
        legalForm: z.string().min(1).optional(),
        legalStatus: z.string().min(1).optional(),
        establishmentAfter: z.string().min(1).optional(),
        establishmentBefore: z.string().min(1).optional(),
        terminationAfter: z.string().min(1).optional(),
        terminationBefore: z.string().min(1).optional(),
        dbModificationDateAfter: z.string().min(1).optional(),
        dbModificationDateBefore: z.string().min(1).optional(),
        mainActivity: z.string().min(1).optional(),
        esa2010: z.string().min(1).optional(),
        sourceRegister: z.string().min(1).optional(),
        // Some MCP clients stringify numeric arguments; a hard z.number() rejects
        // the call outright with "expected number, received string".
        limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .describe(`Maximálny počet vrátených záznamov (default ${DEFAULT_SEARCH_LIMIT}). ` +
            "Register vracia celú množinu naraz, preto sa orezáva až na strane servera; " +
            "count vždy nesie skutočný počet zhôd a truncated hovorí, či je zoznam neúplný."),
    };
    server.registerTool("rpo_search", {
        title: "RPO Search",
        description: "Vyhladanie subjektov (pravnicke osoby, zivnostnici, verejne subjekty) v RPO podla nazvu (fullName) alebo ICO (identifier). " +
            "Diakritika je nepovinna (Vseobecna najde Vseobecna). Aspon jeden parameter je povinny. " +
            "Vysledky su zoradene podla presnosti zhody s fullName (presna zhoda, potom prefix na hranici slova, potom podretazec) " +
            "a orezane na 'limit' zaznamov (default 20). 'count' je vzdy skutocny pocet zhod a 'truncated' hovori, ci je zoznam neuplny — " +
            "pri neuplnom zozname zvys limit alebo zuz dopyt filtrami (onlyActive, addressMunicipality, sourceRegister, ...). " +
            "Vracia normalizovany zoznam s aktualnym nazvom/adresou a internym 'id' pre rpo_get_entity.",
        inputSchema: searchInputSchema,
    }, async (args) => {
        const params = args;
        const { limit, ...searchParams } = params;
        if (!hasAnyParam(searchParams)) {
            return toTextResult({
                ok: false,
                error: "Aspon jeden vyhladavaci parameter je povinny (napr. fullName alebo identifier).",
            });
        }
        try {
            const res = await client.search(searchParams);
            const capped = capResults(normalizeSearch(res), searchParams, limit ?? DEFAULT_SEARCH_LIMIT);
            return toTextResult({ ok: true, ...capped });
        }
        catch (error) {
            return toTextResult(formatSearchError("rpo_search", error, params));
        }
    });
    // -- rpo_get_entity ------------------------------------------------------
    server.registerTool("rpo_get_entity", {
        title: "RPO Get Entity",
        description: "Plny detail subjektu z RPO. Zadajte bud 'id' (interne RPO id zo search vysledkov) alebo 'ico' " +
            "(IČO; server najprv vyhlada id cez identifier= a potom nacita detail). " +
            "Vracia aktualny nazov, adresu, pravnu formu, predmety cinnosti, statutarny organ (mena osob), " +
            "zdrojovy register a statisticke kody (hlavna cinnost NACE, ESA2010). " +
            "Volby showHistoricalData a showOrganizationUnits rozsiruju vystup.",
        inputSchema: {
            id: looseNumber(z.number().int().positive()).optional(),
            ico: z.string().min(1).optional(),
            showHistoricalData: looseBoolean().optional(),
            showOrganizationUnits: looseBoolean().optional(),
        },
    }, async (args) => {
        const opts = {
            showHistoricalData: args.showHistoricalData,
            showOrganizationUnits: args.showOrganizationUnits,
        };
        try {
            if (args.id === undefined && (args.ico === undefined || args.ico === "")) {
                return toTextResult({
                    ok: false,
                    error: "Zadajte 'id' (interne RPO id) alebo 'ico' (IČO).",
                });
            }
            let detail;
            if (args.id !== undefined) {
                detail = await client.getEntityById(args.id, opts);
            }
            else {
                detail = await client.getEntityByIco(args.ico, opts);
                if (detail === null) {
                    return toTextResult({
                        ok: false,
                        error: "Pre zadane IČO nebol najdeny ziadny subjekt.",
                    });
                }
            }
            return toTextResult({ ok: true, entity: toDetailView(detail) });
        }
        catch (error) {
            return toTextResult(formatEntityError("rpo_get_entity", error, args));
        }
    });
    // -- rpo_get_related -----------------------------------------------------
    server.registerTool("rpo_get_related", {
        title: "RPO Get Related Entities",
        description: "Vrati pravnych predchodcov a nastupcov subjektu z RPO — teda firmy, ktore sa do neho zlucili " +
            "(predecessors), a firmy, do ktorych sa subjekt zlucil pri zaniku (successors). " +
            "Zadajte 'id' (interne RPO id) alebo 'ico' (ICO). " +
            "Kazdy zaznam obsahuje ICO, obchodne meno, zjednodusenu adresu a datum ucinnosti (validFrom). " +
            "Pole 'noRelations' je true, ak subjekt nema ziadne zlucenia — to je bezny a platny stav " +
            "(vacsina firiem nema pravnych predchodcov ani nastupcov). " +
            "RPO tu modeluje IBA zlucenia/splynutia/rozdelenia; podiely a spolocnikov overte v ORSR " +
            "podla sprievodneho skillu.",
        inputSchema: {
            id: looseNumber(z.number().int().positive()).optional(),
            ico: z.string().min(1).optional(),
        },
    }, async (args) => {
        try {
            if (args.id === undefined && (args.ico === undefined || args.ico === "")) {
                return toTextResult({
                    ok: false,
                    error: "Zadajte 'id' (interne RPO id) alebo 'ico' (IČO).",
                });
            }
            let detail;
            if (args.id !== undefined) {
                detail = await client.getEntityById(args.id, {});
            }
            else {
                detail = await client.getEntityByIco(args.ico, {});
                if (detail === null) {
                    return toTextResult({
                        ok: false,
                        error: "Pre zadane IČO nebol najdeny ziadny subjekt.",
                    });
                }
            }
            return toTextResult({ ok: true, ...toRelatedView(detail) });
        }
        catch (error) {
            return toTextResult(formatEntityError("rpo_get_related", error, args));
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
function hasAnyParam(params) {
    return Object.values(params).some((v) => v !== undefined && v !== null && v !== "");
}
function formatSearchError(operation, error, input) {
    if (error instanceof RpoApiError) {
        // RPO throws HTTP 500 on overly broad queries (e.g. fullName=obec) instead
        // of a clean "too many results". Surface actionable guidance.
        if (error.status >= 500) {
            return {
                ok: false,
                operation,
                input: redactToolInput(input),
                error_class: safeErrorClass(error),
                error_message: "RPO API vratilo HTTP 500 - dopyt je prilis siroky (prilis vela zhod). " +
                    "Pridajte selektivnejsi vyraz alebo zuzte filtre (addressMunicipality, establishmentAfter, sourceRegister). " +
                    "Pozn.: onlyActive=true samo o sebe siroky dopyt nezuzi.",
                http_status: error.status,
            };
        }
        if (error.status === 400) {
            return {
                ok: false,
                operation,
                input: redactToolInput(input),
                error_class: safeErrorClass(error),
                error_message: "RPO API vratilo HTTP 400 - dopyt nebol pochopeny alebo chyba parameter. " +
                    "Skontrolujte hodnoty (napr. legalForm/sourceRegister ocakavaju platne kody) a zadajte aspon jeden parameter.",
                http_status: error.status,
            };
        }
    }
    return formatToolError(operation, error, input);
}
function formatEntityError(operation, error, input) {
    if (error instanceof RpoApiError && error.status === 404) {
        return {
            ok: false,
            operation,
            input: redactToolInput(input),
            error_class: safeErrorClass(error),
            error_message: "Subjekt s danym id nebol najdeny (HTTP 404).",
            http_status: error.status,
        };
    }
    return formatToolError(operation, error, input);
}
function formatToolError(operation, error, input) {
    const errorClass = safeErrorClass(error);
    safeOperationalLog("error", "tool_failure", {
        operation,
        status: error instanceof RpoApiError ? error.status : 500,
        errorClass,
    });
    return {
        ok: false,
        operation,
        input: redactToolInput(input),
        error_class: errorClass,
        error_message: "Nastroj zlyhal; cielove hodnoty a podrobnosti chyby boli z bezpecnostnych dovodov skryte.",
        http_status: error instanceof RpoApiError ? error.status : undefined,
    };
}
