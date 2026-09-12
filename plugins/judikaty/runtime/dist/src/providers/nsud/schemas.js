import * as z from "zod/v4";
export const NsudDecisionDetailSchema = z.object({
    ID: z.string().optional(),
    cislo: z.string().optional(),
    senat: z.string().optional(),
    ecli: z.string().optional(),
    datum: z.string().optional(),
    kolegium: z.string().optional(),
    merito: z.string().optional(),
    sudca: z.string().optional(),
    obsah: z.string().optional(),
    subor: z.string().optional()
});
//# sourceMappingURL=schemas.js.map