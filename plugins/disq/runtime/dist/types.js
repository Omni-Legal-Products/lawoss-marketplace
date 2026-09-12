import { z } from "zod";
export const MAX_TEXT_BYTES = 256;
export function isStrictSkDate(value) {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
    if (!match)
        return false;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (year < 1 || year > 9999 || month < 1 || month > 12)
        return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
const boundedText = z.string().refine((value) => Buffer.byteLength(value, "utf8") <= MAX_TEXT_BYTES);
const requiredText = boundedText.refine((value) => value.trim().length > 0);
const dateText = boundedText.refine(isStrictSkDate);
export const SuradniceSchema = z.object({
    zemepisnaDlzka: boundedText.optional(),
    zemepisnaSirka: boundedText.optional(),
});
/** Validated public DISQ record. Unknown upstream keys are stripped. */
export const DiskvalifikaciaSchema = z.object({
    registreGuid: requiredText,
    meno: requiredText,
    datumRozhodnutia: dateText.optional(),
    sud: boundedText.optional(),
    adresa: boundedText.optional(),
    suradnice: SuradniceSchema.optional(),
    updateDate: dateText.optional(),
    spisovaZnacka: boundedText.optional(),
    cisloKonania: boundedText.optional(),
    // Some source records carry malformed interval dates. They are omitted from
    // normalized success output and surfaced as a stable warning.
    vylucenieOd: boundedText.optional(),
    vylucenieDo: boundedText.optional(),
    poznamka: boundedText.optional(),
});
export const FacetValueSchema = z.object({ text: boundedText.optional(), count: z.number().int().nonnegative().optional() });
export const FilterSchema = z.object({ filterName: boundedText.optional(), facetValueList: z.array(FacetValueSchema).optional() });
/** A valid list envelope always carries source count, update date and the present row array. */
export const DiskvalifikaciaListResponseSchema = z.object({
    numFound: z.number().int().nonnegative().safe(),
    page: z.number().int().nonnegative().optional(),
    size: z.number().int().nonnegative().optional(),
    updateDate: dateText,
    filterList: z.array(FilterSchema).optional(),
    diskvalifikaciaList: z.array(DiskvalifikaciaSchema),
    diskvalifikaciaMapList: z.array(DiskvalifikaciaSchema).optional(),
});
export const AutocompleteItemSchema = z.object({ registreGuid: requiredText, nazov: requiredText });
export const AutocompleteResponseSchema = z.array(AutocompleteItemSchema);
