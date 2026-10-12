import { z } from "zod";
export const SLUG_VAT_REGISTERED = "ds_dphs";
export const SLUG_VAT_DELETED = "ds_dphv";
export const SLUG_VAT_CANCELLED = "ds_dphz";
export const SLUG_TAX_DEBTORS = "ds_dsdd";
export const SLUG_VAT_IBAN = "ds_dph_iban";
export const SLUG_VAT_TAX_ADMIN_ACCOUNT = "ds_dph_oud";
export const SLUG_TAX_RELIABILITY_INDEX = "ds_iz_ran";
export const SLUG_CORPORATE_INCOME_TAX = "ds_dppos";
export const SLUG_INCOME_TAX_REGISTRATION = "ds_dsrdp";
export const dataPageResponseSchema = z.object({
    page: z.number().int().min(1),
    pages: z.number().int().min(1),
    itemsCount: z.number().int().min(0),
    itemsPerPage: z.number().int().min(0),
    data: z.array(z.record(z.string(), z.unknown())),
}).strict();
export const vatStatusInputSchema = { icDph: z.string().optional(), ico: z.string().optional() };
export const taxDebtorInputSchema = { ico: z.string().optional(), name: z.string().min(1).max(256).optional() };
export const icDphInputSchema = { icDph: z.string() };
export const icoInputSchema = { ico: z.string() };
