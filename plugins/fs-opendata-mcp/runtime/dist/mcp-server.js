import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FsClient } from "./fs-client.js";
import { runFullDueDiligence } from "./due-diligence.js";
import { icDphInputSchema, icoInputSchema, taxDebtorInputSchema, vatStatusInputSchema } from "./types.js";
import { safeError } from "./redaction.js";
export function createFsMcpServer(options = {}) {
    if (options.rateLimiter && !options.rateLimitKey)
        throw new Error("A rate-limit identity is required when MCP rate limiting is enabled.");
    const client = new FsClient();
    const invoke = async (operation, action) => {
        if (options.rateLimiter && options.rateLimitKey) {
            const decision = options.rateLimiter.check(options.rateLimitKey, "mcp");
            if (!decision.allowed)
                return formatRateLimitError(operation, decision.retryAfterSeconds);
        }
        try {
            return toTextResult(await action());
        }
        catch (error) {
            return formatToolError(operation, error);
        }
    };
    const server = new McpServer({
        name: "fs-opendata-mcp",
        version: "0.2.0",
    });
    server.registerTool("fs_vat_status", {
        title: "FS VAT Status",
        description: "Overí stav platiteľa DPH v zoznamoch Finančnej správy SR podľa IČ DPH (SK + 10 číslic) a/alebo IČO (8 číslic). " +
            "Vráti registráciu (ds_dphs) aj vymazané/zrušené registrácie (ds_dphv/ds_dphz). " +
            "Index daňovej spoľahlivosti sa v zoznamoch DPH nevracia — je v samostatnom zozname ds_iz_ran; " +
            "získaj ho cez fs_tax_reliability_index alebo fs_full_due_diligence, ktorý ho doplní.",
        inputSchema: vatStatusInputSchema,
    }, async (args) => invoke("fs_vat_status", () => client.getVatStatus(args)));
    server.registerTool("fs_tax_debtor_check", {
        title: "FS Tax Debtor Check",
        description: "Overí, či je subjekt v zozname daňových dlžníkov Finančnej správy SR (ds_dsdd) podľa názvu subjektu. " +
            "Aktuálne FS API pre ds_dsdd zverejňuje ako searchable iba nazov_subjektu; samotné IČO nestačí. " +
            "Prázdny výsledok = subjekt NIE je dlžník (čistý výsledok).",
        inputSchema: taxDebtorInputSchema,
    }, async (args) => invoke("fs_tax_debtor_check", () => client.checkTaxDebtor(args)));
    server.registerTool("fs_list_metadata", {
        title: "FS List Metadata",
        description: "Vráti verejné metadata Information Lists API Finančnej správy SR vrátane slugov a searchable stĺpcov. Nevypisuje API kľúč.",
        inputSchema: {},
    }, async () => invoke("fs_list_metadata", () => client.listDatasets()));
    server.registerTool("fs_vat_bank_accounts", {
        title: "FS VAT Bank Accounts",
        description: "Vyhľadá zverejnené bankové účty platiteľa DPH používané na podnikanie v zozname ds_dph_iban podľa IČ DPH.",
        inputSchema: icDphInputSchema,
    }, async (args) => invoke("fs_vat_bank_accounts", () => client.getVatBankAccounts(args)));
    server.registerTool("fs_vat_tax_admin_account", {
        title: "FS VAT Tax Admin Account",
        description: "Vyhľadá číslo účtu správcu dane vedené pre daňový subjekt v zozname ds_dph_oud podľa IČ DPH.",
        inputSchema: icDphInputSchema,
    }, async (args) => invoke("fs_vat_tax_admin_account", () => client.getVatTaxAdminAccount(args)));
    server.registerTool("fs_tax_reliability_index", {
        title: "FS Tax Reliability Index",
        description: "Vyhľadá index daňovej spoľahlivosti v zozname ds_iz_ran podľa IČO.",
        inputSchema: icoInputSchema,
    }, async (args) => invoke("fs_tax_reliability_index", () => client.getTaxReliabilityIndex(args)));
    server.registerTool("fs_corporate_income_tax", {
        title: "FS Corporate Income Tax",
        description: "Vyhľadá údaje o výške dane z príjmov právnickej osoby v zozname ds_dppos podľa IČO.",
        inputSchema: icoInputSchema,
    }, async (args) => invoke("fs_corporate_income_tax", () => client.getCorporateIncomeTax(args)));
    server.registerTool("fs_income_tax_registration", {
        title: "FS Income Tax Registration",
        description: "Vyhľadá registráciu subjektu na daň z príjmov v zozname ds_dsrdp podľa IČO.",
        inputSchema: icoInputSchema,
    }, async (args) => invoke("fs_income_tax_registration", () => client.getIncomeTaxRegistration(args)));
    // -- fs_full_due_diligence -------------------------------------------------
    server.registerTool("fs_full_due_diligence", {
        title: "FS Full Due Diligence",
        description: "Kompletný due-diligence report pre jedno IČO. Agreguje výsledky zo všetkých dostupných " +
            "nástrojov finančnej správy: DPH status, daňový dlžník, spoľahlivosť, bankové účty, " +
            "registrácie dane z príjmu. Najprv zistí IČ DPH a názov subjektu, lebo zoznam bankových " +
            "účtov sa dopytuje podľa IČ DPH a zoznam daňových dlžníkov podľa názvu. " +
            "Six mandatory sections determine clean. Optional corporate income tax is reported separately: " +
            "an optional failure remains visible but does not gate clean or make the mandatory report incomplete.",
        inputSchema: {
            ico: z.string().min(8).max(8).describe("IČO, presne 8 číslic."),
        },
    }, async (args) => invoke("fs_full_due_diligence", () => runFullDueDiligence(args.ico, client)));
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
export function formatToolError(operation, error) {
    const payload = { ok: false, operation, error: safeError(error) };
    console.error(JSON.stringify({ component: "fs-mcp", operation, error: payload.error }));
    return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
}
function formatRateLimitError(operation, retryAfterSeconds) {
    const payload = {
        ok: false,
        operation,
        error: { code: "RATE_LIMITED", message: "Request limit reached.", retryAfterSeconds },
    };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
}
// Re-export to mirror template ergonomics (z available to consumers/tests).
export { z };
