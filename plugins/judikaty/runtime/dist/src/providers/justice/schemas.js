import * as z from "zod/v4";
export const JusticeBaseCourtSchema = z.object({
    registreGuid: z.string(),
    nazov: z.string(),
    adresaString: z.string().optional(),
    suradnice: z
        .object({
        zemepisnaDlzka: z.string().optional(),
        zemepisnaSirka: z.string().optional()
    })
        .optional()
});
export const JusticeJudgeSchema = z.object({
    registreGuid: z.string().optional(),
    meno: z.string().optional()
});
export const JusticeDecisionListItemSchema = z.object({
    guid: z.string(),
    formaRozhodnutia: z.string().optional(),
    povaha: z.array(z.string()).optional(),
    sud: z.object({
        registreGuid: z.string().optional(),
        nazov: z.string().optional()
    }),
    sudca: JusticeJudgeSchema.optional(),
    identifikacneCislo: z.string().optional(),
    spisovaZnacka: z.string().optional(),
    datumVydania: z.string().optional(),
    zvyraznenie: z.array(z.unknown()).optional()
});
export const JusticeDecisionListResponseSchema = z.object({
    numFound: z.number().int().nonnegative(),
    page: z.number().int(),
    size: z.number().int(),
    updateDate: z.string().optional(),
    filterList: z.array(z.unknown()).optional(),
    rozhodnutieList: z.array(JusticeDecisionListItemSchema).default([])
});
export const JusticeCitedRegulationSchema = z.object({
    nazov: z.string().optional(),
    url: z.string().optional()
});
export const JusticeDocumentSchema = z.object({
    name: z.string().optional(),
    fileExtension: z.string().optional(),
    size: z.number().optional(),
    url: z.string().optional()
});
export const JusticeDecisionDetailSchema = z.object({
    guid: z.string(),
    formaRozhodnutia: z.string().optional(),
    povaha: z.array(z.string()).optional(),
    sud: z.object({
        registreGuid: z.string().optional(),
        nazov: z.string().optional()
    }),
    sudca: JusticeJudgeSchema.optional(),
    identifikacneCislo: z.string().optional(),
    spisovaZnacka: z.string().optional(),
    datumVydania: z.string().optional(),
    ecli: z.string().optional(),
    oblast: z.array(z.string()).optional(),
    podOblast: z.array(z.string()).optional(),
    odkazovanePredpisy: z.array(JusticeCitedRegulationSchema).optional(),
    dokument: JusticeDocumentSchema.optional(),
    updateDate: z.string().optional(),
    povodnySud: z.union([z.string(), JusticeBaseCourtSchema]).optional(),
    povodnaSpisovaZnacka: z.string().optional()
});
export const JusticeCourtAutocompleteItemSchema = z.object({
    registreGuid: z.string(),
    nazov: z.string()
});
export const JusticeDecisionAutocompleteItemSchema = z.object({
    guid: z.string(),
    forma: z.string().optional(),
    sud: z.string().optional(),
    spisovaZnacka: z.string().optional()
});
export const JusticeCourtDetailSchema = JusticeBaseCourtSchema.extend({
    ico: z.string().optional(),
    typSudu: z.string().optional(),
    ukonceny_string: z.string().optional(),
    skratka_string: z.string().optional(),
    adresa: z
        .object({
        obec: z.string().optional(),
        ulica: z.string().optional(),
        psc: z.string().optional(),
        krajina: z.string().optional()
    })
        .optional()
});
//# sourceMappingURL=schemas.js.map