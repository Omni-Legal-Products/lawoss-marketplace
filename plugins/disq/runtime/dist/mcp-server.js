import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DisqClient, DisqSourceError, foldName, toDetailView } from "./disq-client.js";
import { safeError } from "./redaction.js";
import { looseNumber } from "./scalars.js";
export const SERVER_VERSION = "0.1.0";
const unknownField = (description) => z.unknown().optional().describe(description);
function inputFailure() {
    return formatToolError("input", new DisqSourceError("DISQ_INPUT"));
}
function hintProvided(value) {
    if (value === undefined)
        return false;
    if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value.trim(), "utf8") > 256 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value))
        return undefined;
    return true;
}
function callbackSize(value) {
    if (value === undefined)
        return 200;
    if (typeof value === "string" && /^[0-9]+$/.test(value.trim()))
        value = Number(value.trim());
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 2_000)
        throw new DisqSourceError("DISQ_INPUT");
    return value;
}
function callbackGuid(value) {
    if (typeof value !== "string")
        throw new DisqSourceError("DISQ_INPUT");
    const guid = value.trim();
    if (!guid || Buffer.byteLength(guid, "utf8") > 256 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(guid))
        throw new DisqSourceError("DISQ_INPUT");
    return guid;
}
export function createDisqMcpServer(options = {}) {
    const client = options.client ?? new DisqClient(options.clientOptions);
    const server = new McpServer({ name: "register-diskvalifikacii-mcp", version: SERVER_VERSION });
    const rateLimited = () => {
        if (!options.rateLimiter || !options.rateLimitKey)
            return undefined;
        const decision = options.rateLimiter.check(options.rateLimitKey, "mcp");
        return decision.allowed ? undefined : toTextResult({ ok: false, code: "RATE_LIMITED", message: "Request rate limit exceeded.", warnings: [] }, true);
    };
    server.registerTool("disq_check", {
        title: "DISQ public-register name check",
        description: "Read-only name query against the Slovak public DISQ source. Returns status matches, no_match, or incomplete only after source validation. " +
            "no_match means only that the folded query returned no record at the reported source update/retrieval time; it does not establish identity, eligibility, or good standing. " +
            "Date of birth and IČO are non-searchable hints: when provided they are ignored by the source and represented only by warning markers. Use disq_get_detail for a selected opaque registreGuid.",
        inputSchema: {
            name: unknownField("Full person name. Required; folded for a name-only public-register query."),
            dob: unknownField("Optional date-of-birth hint. Not searchable and never sent to DISQ."),
            ico: unknownField("Optional IČO hint. Not searchable and never sent to DISQ."),
            size: looseNumber(z.number().int().min(1).max(2_000)).optional().describe("Integer or integer string from 1 to 2000. Default 200."),
        },
    }, async (args) => {
        const limited = rateLimited();
        if (limited)
            return limited;
        if (typeof args.name !== "string")
            return inputFailure();
        const dob = hintProvided(args.dob);
        const ico = hintProvided(args.ico);
        if (dob === undefined || ico === undefined)
            return inputFailure();
        try {
            foldName(args.name);
            const result = await client.check(args.name.trim(), callbackSize(args.size));
            const warnings = [...result.warnings];
            if (dob)
                warnings.push("DOB_PROVIDED_BUT_NOT_SEARCHABLE");
            if (ico)
                warnings.push("ICO_PROVIDED_BUT_NOT_SEARCHABLE");
            return toTextResult({ ...result, warnings });
        }
        catch (error) {
            return formatToolError("disq_check", error);
        }
    });
    server.registerTool("disq_get_detail", {
        title: "DISQ public-register record detail",
        description: "Read-only detail lookup in the public DISQ source using the opaque registreGuid returned by disq_check. " +
            "Returns only validated public-register fields, source freshness, warnings, and an inclusive UTC date-only interval assessment. It does not verify identity and is not legal advice.",
        inputSchema: { registreGuid: unknownField("Opaque record identifier returned by disq_check.") },
    }, async (args) => {
        const limited = rateLimited();
        if (limited)
            return limited;
        if (typeof args.registreGuid !== "string")
            return inputFailure();
        try {
            const record = await client.getByGuid(callbackGuid(args.registreGuid));
            return toTextResult(toDetailView(record, options.now));
        }
        catch (error) {
            return formatToolError("disq_get_detail", error);
        }
    });
    return server;
}
export function toTextResult(payload, isError = false) {
    return {
        ...(isError ? { isError: true } : {}),
        content: [{ type: "text", text: JSON.stringify(payload) }],
    };
}
export function formatToolError(_operation, error) {
    const safe = safeError(error);
    return toTextResult({ ok: false, code: safe.code, message: safe.message, warnings: [] }, true);
}
