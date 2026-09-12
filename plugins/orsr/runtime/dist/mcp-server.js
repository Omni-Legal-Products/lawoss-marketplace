import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OrsrClient, OrsrInputError, OrsrRequestError } from "./orsr-client.js";
import { looseBoolean, looseNumber } from "./scalars.js";
import { buildCompanyBasicProfile, buildCompanyProfile } from "./company-profile.js";
import { redactEntityTargetInput } from "./redaction.js";
export function createOrsrMcpServer() {
    const client = new OrsrClient();
    const server = new McpServer({
        name: "orsr-mcp",
        version: "0.1.0",
    });
    /**
     * Nine of the thirteen tools had no error handling, so an upstream failure
     * escaped as a raw protocol error and bypassed the classification entirely —
     * the caller got "ORSR request failed (400) Bad Request" with no error_code,
     * no `retriable` and no hint. Wrap every tool the same way.
     */
    const guard = (operation, run) => async (args) => {
        try {
            return toTextResult(await run(args));
        }
        catch (error) {
            return toTextResult(formatToolError(operation, error, args), true);
        }
    };
    const searchInputSchema = {
        skip: looseNumber(z.number().int().min(0)).optional(),
        take: looseNumber(z.number().int().min(1).max(200)).optional(),
        sortDirection: z.enum(["Ascending", "Descending"]).optional(),
        sortFieldName: z.string().min(1).optional(),
        filters: z
            .object({
            corporateBodyFullNameOrRegistrationNumber: z.string().optional(),
            corporateBodyNameLike: looseBoolean()
                .optional()
                .describe("Modifikátor, NIE názov. Ovplyvňuje, ako voľne sa páruje meno zadané v " +
                "corporateBodyFullNameOrRegistrationNumber: true = podreťazec (\"ESET\" nájde aj " +
                "\"Airbagreset\"), false = tesná zhoda. Sám o sebe vyhľadávanie nespustí."),
            court: z.union([z.string(), z.number().int()]).optional(),
            fileReferenceCourt: z.string().optional(),
            fileReferenceSection: z.string().optional(),
            fileReferenceInsertNumber: looseNumber(z.number().int()).optional(),
            includeTerminated: looseBoolean().optional(),
            legalForm: looseNumber(z.number().int()).optional(),
            physicalPersonName: z.string().optional(),
            physicalPersonType: z.union([z.string(), z.number().int()]).optional(),
            addressStreet: z.string().optional(),
            addressNumber: z.union([z.string(), z.number().int()]).optional(),
            addressMunicipality: z.string().optional(),
        })
            .optional(),
    };
    const fileReferenceSchema = {
        oddiel: z.string().min(1),
        vlozka: z.union([z.string().min(1), z.number().int().min(1)]),
        sud: z.string().min(1),
    };
    const outputOptionsSchema = {
        normalizeDates: looseBoolean().optional(),
        stakeholdersOnly: looseBoolean().optional(),
        strictCurrent: looseBoolean().optional(),
    };
    server.registerTool("orsr_search_entities", {
        title: "ORSR Search",
        description: "Vyhladanie subjektov v ORSR podla mena, ICO, adresy alebo spisovej znacky.",
        inputSchema: searchInputSchema,
    }, guard("orsr_search_entities", async (args) => client.searchLegalPersons(args)));
    server.registerTool("orsr_get_extract", {
        title: "ORSR Extract",
        description: "Zakladny detail subjektu podla oddielu, vlozky a sudu.",
        inputSchema: fileReferenceSchema,
    }, guard("orsr_get_extract", async (args) => client.getExtract(args)));
    server.registerTool("orsr_get_extract_full", {
        title: "ORSR Extract Full",
        description: "Plny detail subjektu (historicke a rozsireny payload).",
        inputSchema: fileReferenceSchema,
    }, guard("orsr_get_extract_full", async (args) => client.getExtractFull(args)));
    server.registerTool("orsr_get_documents", {
        title: "ORSR Documents",
        description: "Zoznam listin subjektu.",
        inputSchema: fileReferenceSchema,
    }, guard("orsr_get_documents", async (args) => client.getDocuments(args)));
    server.registerTool("orsr_get_related", {
        title: "ORSR Related",
        description: "Suvisejace subjekty v ORSR.",
        inputSchema: fileReferenceSchema,
    }, guard("orsr_get_related", async (args) => client.getRelated(args)));
    server.registerTool("orsr_lookup_legal_person", {
        title: "ORSR Legal Person Lookup",
        description: "Rychly autocomplete pre pravnicke osoby v ORSR.",
        inputSchema: {
            query: z.string().min(1),
            draw: looseNumber(z.number().int().min(1)).optional(),
            variant: z.enum(["orsr", "orsrComplete", "allLegalPersons"]).optional(),
        },
    }, guard("orsr_lookup_legal_person", async (args) => {
        const variant = args.variant ?? "orsr";
        if (variant === "orsrComplete") {
            return await client.lookupOrsrLegalPersonsComplete(args);
        }
        if (variant === "allLegalPersons") {
            return await client.lookupLegalPersons(args);
        }
        return await client.lookupOrsrLegalPersons(args);
    }));
    server.registerTool("orsr_lookup_address", {
        title: "ORSR Address Lookup",
        description: "Autocomplete adries pouzivany ORSR vyhladavanim.",
        inputSchema: {
            query: z.string().min(1),
            draw: looseNumber(z.number().int().min(1)).optional(),
        },
    }, guard("orsr_lookup_address", async (args) => client.lookupAddress(args)));
    server.registerTool("orsr_check_legal_person", {
        title: "ORSR Check Legal Person",
        description: "Overenie pravnickej osoby cez check endpoint.",
        inputSchema: {
            query: z.string().min(1),
        },
    }, guard("orsr_check_legal_person", async (args) => client.checkLegalPerson(args.query)));
    server.registerTool("orsr_codelist_get", {
        title: "ORSR Codelist",
        description: "Nacitanie ORSR codelistu podla kodu (napr. ORSR-Section).",
        inputSchema: {
            codelistCode: z.string().min(1),
        },
    }, guard("orsr_codelist_get", async (args) => client.getCodelist(args.codelistCode)));
    server.registerTool("orsr_get_company_profile", {
        title: "ORSR Company Profile",
        description: "Strukturovany profil subjektu: historicki/aktualni konatelia, spolocnici, podiely, akcie, sposob konania, uctovne zavierky, indikatory fuzie/nastupnictva.",
        inputSchema: fileReferenceSchema,
    }, async (args) => {
        try {
            const [extractFull, documents] = await Promise.all([
                client.getExtractFull(args),
                client.getDocuments(args),
            ]);
            const profile = buildCompanyProfile({}, extractFull, Array.isArray(documents) ? documents : []);
            return toTextResult(profile);
        }
        catch (error) {
            return toTextResult(formatToolError("orsr_get_company_profile", error, args), true);
        }
    });
    server.registerTool("orsr_get_company_profile_by_query", {
        title: "ORSR Company Profile By Query",
        description: "Vyhlada subjekt podla nazvu/ICO a vrati strukturovany profil s detailmi konatelov, spolocnikov, podielov, sposobu konania a udalosti.",
        inputSchema: {
            query: z.string().min(1),
        },
    }, async (args) => {
        try {
            const search = (await client.searchLegalPersons({
                take: 20,
                sortDirection: "Ascending",
                sortFieldName: "CorporateBodyFullName",
                filters: {
                    corporateBodyFullNameOrRegistrationNumber: args.query,
                },
            }));
            const resolved = resolveCompanySearchResult(args.query, Array.isArray(search?.data) ? search.data : []);
            if (resolved.kind !== "selected") {
                return toTextResult({
                    query: "[REDACTED]",
                    error_code: resolved.kind === "ambiguous" ? "AMBIGUOUS" : "NOT_FOUND",
                    ...(resolved.kind === "ambiguous" ? {
                        candidates: resolved.candidates,
                        candidates_truncated: resolved.candidates_truncated,
                        limit: resolved.limit,
                    } : {}),
                }, false);
            }
            const first = resolved.item;
            if (!hasFileReference(first)) {
                return toTextResult({ query: "[REDACTED]", error_code: "NOT_FOUND", error: "Subjekt nema validny fileReference." }, false);
            }
            const ref = {
                oddiel: String(first.fileReference.section),
                vlozka: Number(first.fileReference.insertNumber),
                sud: String(first.fileReference.court),
            };
            const [extractFull, documents] = await Promise.all([
                client.getExtractFull(ref),
                client.getDocuments(ref),
            ]);
            const profile = buildCompanyProfile(first, extractFull, Array.isArray(documents) ? documents : []);
            return toTextResult(profile);
        }
        catch (error) {
            return toTextResult(formatToolError("orsr_get_company_profile_by_query", error, args), true);
        }
    });
    server.registerTool("orsr_get_company_data", {
        title: "ORSR Company Data",
        description: "Vrati data firmy v dvoch urovniach: basic (predvolene, pre zmluvy) alebo deep (hlbsi resers).",
        inputSchema: {
            ...fileReferenceSchema,
            level: z.enum(["basic", "deep"]).optional(),
            ...outputOptionsSchema,
        },
    }, async (args) => {
        try {
            const level = args.level ?? "basic";
            const ref = { oddiel: args.oddiel, vlozka: args.vlozka, sud: args.sud };
            const options = pickOutputOptions(args);
            if (level === "deep") {
                const [extractFull, documents] = await Promise.all([
                    client.getExtractFull(ref),
                    client.getDocuments(ref),
                ]);
                const profile = buildCompanyProfile({}, extractFull, Array.isArray(documents) ? documents : []);
                return toTextResult(applyOutputOptions(profile, options, "deep"));
            }
            const extract = await client.getExtract(ref);
            const basic = buildCompanyBasicProfile({}, extract);
            return toTextResult(applyOutputOptions(basic, options, "basic"));
        }
        catch (error) {
            return toTextResult(formatToolError("orsr_get_company_data", error, args), true);
        }
    });
    server.registerTool("orsr_get_company_data_by_query", {
        title: "ORSR Company Data By Query",
        description: "Najde firmu podla nazvu/ICO a vrati basic (default) alebo deep data podla level.",
        inputSchema: {
            query: z.string().min(1),
            level: z.enum(["basic", "deep"]).optional(),
            ...outputOptionsSchema,
        },
    }, async (args) => {
        try {
            const level = args.level ?? "basic";
            const options = pickOutputOptions(args);
            const search = (await client.searchLegalPersons({
                take: 20,
                sortDirection: "Ascending",
                sortFieldName: "CorporateBodyFullName",
                filters: {
                    corporateBodyFullNameOrRegistrationNumber: args.query,
                },
            }));
            const resolved = resolveCompanySearchResult(args.query, Array.isArray(search?.data) ? search.data : []);
            if (resolved.kind !== "selected") {
                return toTextResult({
                    query: "[REDACTED]",
                    level,
                    error_code: resolved.kind === "ambiguous" ? "AMBIGUOUS" : "NOT_FOUND",
                    ...(resolved.kind === "ambiguous" ? {
                        candidates: resolved.candidates,
                        candidates_truncated: resolved.candidates_truncated,
                        limit: resolved.limit,
                    } : {}),
                }, false);
            }
            const first = resolved.item;
            if (!hasFileReference(first)) {
                return toTextResult({ query: "[REDACTED]", level, error_code: "NOT_FOUND", error: "Subjekt nema validny fileReference." }, false);
            }
            const ref = {
                oddiel: String(first.fileReference.section),
                vlozka: Number(first.fileReference.insertNumber),
                sud: String(first.fileReference.court),
            };
            if (level === "deep") {
                const [extractFull, documents] = await Promise.all([
                    client.getExtractFull(ref),
                    client.getDocuments(ref),
                ]);
                const profile = buildCompanyProfile(first, extractFull, Array.isArray(documents) ? documents : []);
                return toTextResult(applyOutputOptions(profile, options, "deep"));
            }
            const extract = await client.getExtract(ref);
            const basic = buildCompanyBasicProfile(first, extract);
            return toTextResult(applyOutputOptions(basic, options, "basic"));
        }
        catch (error) {
            return toTextResult(formatToolError("orsr_get_company_data_by_query", error, args), true);
        }
    });
    return server;
}
export function toTextResult(payload, isError = false) {
    return {
        isError,
        content: [
            {
                type: "text",
                text: JSON.stringify(payload, null, 2),
            },
        ],
    };
}
/**
 * Every failure used to collapse into UPSTREAM_ERROR / "Upstream ORSR request
 * failed.", so a slow upstream, a rejected parameter and a server fault looked
 * identical and the caller could not tell whether retrying was worth anything.
 * The upstream status code is not confidential — the entity being looked up is,
 * and that stays out of the logs via sanitizeUrlForLogs.
 */
export function classifyToolError(error) {
    // Argument validation fails before any request is made. Its message names the
    // criteria that would make the call valid and contains no entity data, so it
    // must reach the caller intact rather than collapse into a generic upstream
    // failure the caller cannot act on.
    if (error instanceof OrsrInputError) {
        return { error_code: "INVALID_REQUEST", error_message: error.message, retriable: false };
    }
    const kind = error instanceof OrsrRequestError ? error.kind : "unknown";
    const status = error instanceof OrsrRequestError ? error.status : undefined;
    if (kind === "timeout") {
        return {
            error_code: "UPSTREAM_TIMEOUT",
            error_message: "ORSR neodpovedalo v časovom limite.",
            retriable: true,
            hint: "sluzby.orsr.sk býva pomalé a občas nedostupné. Skús znova o chvíľu; " +
                "ak stačí základná identifikácia subjektu, RPO ju vie dodať hneď.",
        };
    }
    if (kind === "network") {
        return {
            error_code: "UPSTREAM_UNREACHABLE",
            error_message: "Na ORSR sa nepodarilo pripojiť.",
            retriable: true,
        };
    }
    if (kind === "upstream_status" && status !== undefined) {
        if (status === 400 || status === 404 || status === 422) {
            return {
                error_code: "INVALID_REQUEST",
                error_message: `ORSR odmietlo dopyt (HTTP ${status}).`,
                retriable: false,
                hint: "Skontroluj oddiel, vložku a súd — súd sa zadáva kódom (napr. 'B'), nie názvom. " +
                    "Platnú trojicu vráti orsr_search_entities vo fileReference.",
                upstream_status: status,
            };
        }
        return {
            error_code: "UPSTREAM_STATUS",
            error_message: `ORSR vrátilo chybu (HTTP ${status}).`,
            retriable: status >= 500 || status === 429 || status === 408,
            upstream_status: status,
        };
    }
    if (kind === "malformed") {
        return {
            error_code: "UPSTREAM_MALFORMED",
            error_message: "ORSR vrátilo odpoveď, ktorá nie je platný JSON.",
            retriable: true,
        };
    }
    return {
        error_code: "UPSTREAM_ERROR",
        error_message: "Volanie na ORSR zlyhalo.",
        retriable: false,
    };
}
export function formatToolError(operation, error, input) {
    const classified = classifyToolError(error);
    if (error instanceof Error) {
        // Logs stay free of the entity being looked up; only the failure class goes in.
        console.error(`[orsr-mcp] tool ${operation} failed`, {
            operation,
            error_code: classified.error_code,
            upstream_status: classified.upstream_status,
        });
    }
    return {
        ok: false,
        ...classified,
        operation,
        // Entity targets stay redacted — that is a deliberate confidentiality
        // decision (which subject was looked up is itself sensitive) and is covered
        // by tests. The `hint` above carries the actionable part instead, so a
        // caller can correct a bad parameter without the values being echoed.
        input: redactEntityTargetInput(input),
        at: new Date().toISOString(),
    };
}
const AMBIGUITY_LIMIT = 20;
export function resolveCompanySearchResult(query, items) {
    const candidates = items.filter(hasFileReference);
    if (candidates.length === 0)
        return { kind: "not_found" };
    const normalizedQuery = normalizeIcoQuery(query);
    if (normalizedQuery && /^\d{8}$/.test(normalizedQuery)) {
        const exact = candidates.filter((item) => normalizeIcoQuery(item?.registrationNumber) === normalizedQuery);
        return exact.length === 1 ? { kind: "selected", item: exact[0] } : exact.length > 1 ? ambiguity(exact) : { kind: "not_found" };
    }
    return candidates.length === 1 ? { kind: "selected", item: candidates[0] } : ambiguity(candidates);
}
function ambiguity(items) {
    return {
        kind: "ambiguous",
        candidates: items.slice(0, AMBIGUITY_LIMIT).map(candidateSummary),
        candidates_truncated: true,
        limit: AMBIGUITY_LIMIT,
    };
}
function candidateSummary(item) {
    return { corporateBodyFullName: item?.corporateBodyFullName ?? null, registrationNumber: item?.registrationNumber ?? null, fileReference: item?.fileReference ?? null };
}
function hasFileReference(item) {
    return Boolean(item?.fileReference?.section && item?.fileReference?.insertNumber && item?.fileReference?.court);
}
function normalizeIcoQuery(value) {
    return typeof value === "string" || typeof value === "number" ? String(value).replace(/\s+/g, "").trim() : "";
}
function pickOutputOptions(args) {
    return {
        normalizeDates: Boolean(args?.normalizeDates),
        stakeholdersOnly: Boolean(args?.stakeholdersOnly),
        strictCurrent: Boolean(args?.strictCurrent),
    };
}
export function applyOutputOptions(payload, options, level) {
    let out = structuredClone(payload);
    if (options.stakeholdersOnly) {
        if (level === "basic") {
            out.stakeholdersCurrent = (out.stakeholdersCurrent ?? []).filter(isShareholderStakeholder);
        }
        else {
            out.stakeholders = {
                current: (out.stakeholders?.current ?? []).filter(isShareholderStakeholder),
                historical: (out.stakeholders?.historical ?? []).filter(isShareholderStakeholder),
                all: (out.stakeholders?.all ?? []).filter(isShareholderStakeholder),
            };
        }
    }
    if (options.strictCurrent) {
        if (level === "basic") {
            out.executivesCurrent = (out.executivesCurrent ?? []).filter((x) => x?.current);
            out.stakeholdersCurrent = (out.stakeholdersCurrent ?? []).filter((x) => x?.current);
        }
        else {
            out.nameHistory = (out.nameHistory ?? []).filter((x) => x?.current);
            out.statutoryBody = {
                ...out.statutoryBody,
                current: (out.statutoryBody?.current ?? []).filter((x) => x?.current),
                historical: [],
                all: (out.statutoryBody?.current ?? []).filter((x) => x?.current),
                statutoryBodyTypeHistory: (out.statutoryBody?.statutoryBodyTypeHistory ?? []).filter((x) => x?.current),
            };
            out.stakeholders = {
                current: (out.stakeholders?.current ?? []).filter((x) => x?.current),
                historical: [],
                all: (out.stakeholders?.current ?? []).filter((x) => x?.current),
            };
            out.shares = {
                ...out.shares,
                items: (out.shares?.items ?? []).filter((x) => x?.current),
            };
            out.actingRules = {
                statutory: (out.actingRules?.statutory ?? []).filter((x) => x?.current),
                proxy: (out.actingRules?.proxy ?? []).filter((x) => x?.current),
                liquidator: (out.actingRules?.liquidator ?? []).filter((x) => x?.current),
            };
            out.mergerIndicators = {
                ...out.mergerIndicators,
                predecessorEntities: (out.mergerIndicators?.predecessorEntities ?? []).filter((x) => x?.current),
            };
        }
    }
    if (options.normalizeDates) {
        out = normalizeDateAnomalies(out);
    }
    return out;
}
function isShareholderStakeholder(item) {
    const code = String(item?.typeCode ?? "").trim();
    const name = String(item?.type ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    return code === "2" || name === "spolocnik";
}
function normalizeDateAnomalies(payload) {
    const walk = (node) => {
        if (Array.isArray(node)) {
            return node.map(walk);
        }
        if (!node || typeof node !== "object") {
            return node;
        }
        const next = {};
        for (const [k, v] of Object.entries(node)) {
            next[k] = walk(v);
        }
        if (typeof next.od === "string" && typeof next.do === "string") {
            const odTs = Date.parse(next.od);
            const doTs = Date.parse(next.do);
            if (Number.isFinite(odTs) && Number.isFinite(doTs) && odTs > doTs) {
                next.do = null;
                next._dateNormalized = true;
            }
        }
        return next;
    };
    return walk(payload);
}
