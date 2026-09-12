import { z } from "zod";
import { looseNumber } from "./scalars.js";
// ---------------------------------------------------------------------------
// Kapitola (chapter) taxonomy — exact $cmbKapitola option values harvested from
// the live FormulareVyhladavanie.aspx form. These are the insolvency /
// liquidation / auction sections relevant for due diligence.
// ---------------------------------------------------------------------------
export const KAPITOLA_CODES = {
    OV_KaR: "Konkurzy a reštrukturalizácie",
    OV_KaV: "Konkurzy a vyrovnania",
    OV_PR: "Preventívne reštrukturalizácie",
    OV_OaVL: "Oznámenia a výzvy likvidátorov",
    OV_OZKZSADBL: "Oznámenia súdov súvisiace so zrušením spoločnosti a dodatočnou likvidáciou",
    OV_D: "Dražby - dobrovoľní dražobníci",
    OV_D_SD: "Dražby - správcovia dane",
    OV_Ex: "Exekúcie - súdni exekútori",
    OV_PM: "Predaj majetku",
};
/** Convenience groups for DD: combine related kapitola codes. */
export const KAPITOLA_GROUPS = {
    insolvency: ["OV_KaR", "OV_KaV", "OV_PR"],
    liquidation: ["OV_OaVL", "OV_OZKZSADBL"],
    auction: ["OV_D", "OV_D_SD", "OV_Ex", "OV_PM"],
};
// ---------------------------------------------------------------------------
// Input schemas (zod) for the MCP tools
// ---------------------------------------------------------------------------
/** ov_search input. At least one of name / ico / keywords / mark / kapitola required. */
export const ovSearchInputSchema = {
    /** Business name or person name (txtObchodneMenoMenoPriezvisko). */
    name: z.string().min(1).max(256).optional(),
    /** IČO, numeric (txtIco). */
    ico: z.string().regex(/^\d{8}$/, "IČO musí mať presne 8 ASCII číslic").optional(),
    /** Fulltext keywords (txtKlucoveSlova). */
    keywords: z.string().min(1).max(256).optional(),
    /** Mark / number / code / IČO (txtZnackaCisloKod). */
    mark: z.string().min(1).max(256).optional(),
    /** Seat / residence (txtSidloBydlisko). */
    seat: z.string().min(1).max(256).optional(),
    /** Chapter code — one of KAPITOLA_CODES keys (cmbKapitola). */
    kapitola: z.string().min(1).optional(),
    /** DD chapter group convenience: expands to a kapitola code set. */
    kapitolaGroup: z.enum(["insolvency", "liquidation", "auction"]).optional(),
    /** Year filter ('' = all). E.g. "2025". */
    year: z.string().regex(/^\d{4}$/, "Rok musí byť 4-ciferný").optional(),
    /** Publication date dd.mm.yyyy (txtDatumZverejnenia, single day). */
    date: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/, "Dátum vo formáte dd.mm.yyyy").optional(),
    /** Page number (1-based). */
    page: looseNumber(z.number().int().min(1).max(20)).optional(),
    /** Results per page: 10 | 20 | 50 | 100. */
    countOnPage: z.union([z.literal(10), z.literal(20), z.literal(50), z.literal(100)]).optional(),
};
/** ov_get_notice input. */
export const ovGetNoticeInputSchema = {
    /** IdFormular from a search result row. */
    idFormular: looseNumber(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)),
};
