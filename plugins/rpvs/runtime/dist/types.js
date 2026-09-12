import { z } from "zod";
// ---------------------------------------------------------------------------
// Zod input schemas for the MCP tools
// ---------------------------------------------------------------------------
export const searchInputSchema = {
    query: z
        .string()
        .min(1)
        .describe("Obchodne meno (nazov) partnera verejneho sektora, alebo 8-miestne ICO."),
    by: z
        .enum(["auto", "name", "ico"])
        .optional()
        .describe("Sposob vyhladavania. 'auto' (default) detekuje ICO podla cislic, inak hlada podla mena."),
    match: z
        .enum(["contains", "startswith"])
        .optional()
        .describe("Pri vyhladavani podla mena: substring (contains, default) alebo prefix (startswith)."),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximalny pocet vysledkov (client-side, default 20). Server $top je zakazany."),
};
export const looseBoolean = z.preprocess((v) => (typeof v === "string" ? (v === "true" ? true : v === "false" ? false : v) : v), z.boolean());
export const icoSchema = z
    .string()
    .regex(/^[0-9]{8}$/, "IČO must contain exactly eight ASCII digits.");
const getPartnerInputShape = {
    ico: icoSchema
        .optional()
        .describe("ICO partnera verejneho sektora (8 cislic). Odporucany vstupny bod."),
    partnerId: z.coerce
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Primarny kluc Partneri (Id == CisloVlozky / cislo vlozky)."),
    includeVerifications: looseBoolean
        .optional()
        .describe("Pripojit metadata verifikacnych dokumentov (default true). Binarne PDF sa nestahuje."),
    includeHistory: looseBoolean
        .optional()
        .describe("Pripojit historicke zaznamy: ubos.all, authorizedPersons.all a partnerHistory (default false). " +
        "Bezne preverenie potrebuje len aktualnych KUV; ubos.all nesie vsetky zaznamy od zapisu " +
        "a aktualne v nom navyse figuruju druhykrat. Pri false zostava historyCount, aby bolo vidno, " +
        "ze historia existuje, a historyOmitted: true hovori, ze bola vynechana."),
};
export const getPartnerInputSchema = z
    .object(getPartnerInputShape)
    .strict()
    .refine((input) => (input.ico === undefined) !== (input.partnerId === undefined), {
    message: "Provide exactly one of ico or partnerId.",
});
export const bulkLookupInputSchema = {
    icoList: z
        .array(icoSchema)
        .min(1)
        .max(20)
        .describe("Zoznam IČO (max 20), každé presne 8 ASCII číslic."),
};
