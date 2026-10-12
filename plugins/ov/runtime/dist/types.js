import { z } from "zod";
import { looseNumber } from "./scalars.js";
// ---------------------------------------------------------------------------
// Kapitola (chapter) taxonomy — the complete list of $cmbKapitola option values
// on the live FormulareVyhladavanie.aspx form (harvested 9. 10. 2026). A code
// outside this list is rejected: the source would not filter by it and the
// answer would read as "nothing found".
// ---------------------------------------------------------------------------
export const KAPITOLA_CODES = {
    OV_DOch: "Dočasná ochrana",
    OV_D: "Dražby – dobrovoľní dražobníci",
    OV_D_SD: "Dražby – správcovia dane",
    OV_EP: "Emisné podmienky",
    OV_Ex: "Exekúcie – súdni exekútori",
    OV_KaR: "Konkurzy a reštrukturalizácie",
    OV_KaV: "Konkurzy a vyrovnania",
    OV_OR: "Obchodný register",
    OV_OR_25112021: "Obchodný register - oprava zverejnenia 25.11.2021",
    OV_OR_27052022: "Obchodný register - oprava zverejnenia 27.05.2022",
    OR_ZOnaV: "Obchodný register – Zoznam osôb, ktoré môžu byť vymazané (§ 768s OBZ)",
    OV_OPR: "Oprava zverejnených údajov v Obchodnom vestníku",
    OV_O: "Oznámenia",
    OV_OaVL: "Oznámenia a výzvy likvidátorov",
    OV_OZKZSADBL: "Oznámenia súdov súvisiace so zrušením spoločnosti (družstva) a dodatočnou likvidáciou",
    OV_PM: "Predaj majetku",
    OV_PR: "Preventívne reštrukturalizácie",
    OV_P: "Prospekty",
    OV_RaOOVM: "Rozhodnutia a oznámenia orgánov verejnej moci",
    OV_RoP: "Rozhodnutia o privatizácii",
    OV_RS: "Rozsudky súdov",
    OV_SoH: "Správy o hospodárení",
    OV_SPPZDzP: "Špecifikácia prijatého podielu zaplatenej dane z príjmov",
    OV_SPaIPP: "Štátna pomoc a iné programy podpory",
    OV_TPaRoT: "Transformačné projekty a rozhodnutia o transformácii",
    OV_UZ: "Účtovné závierky",
    OV_UZRRU: "Údaje z registra registrových úradov",
    OV_VZ: "Valné zhromaždenia",
    OV_VS: "Verejné súťaže",
    OV_VV: "Verejné vyhlášky",
    OV_VZP: "Verejné zdravotné poistenie",
    OV_VAkUZN: "Výroky audítorov k účtovným závierkam nadácií",
    OV_VNUNA: "Výzvy na upisovanie nových akcií",
    OV_ZL: "Zbierka listín",
    OV_ZMLUVA: "Zmluvy",
    OV_Zal_zamery: "Žalobné zámery – ochrana kolektívnych záujmov spotrebiteľov",
};
/**
 * Observed source fact, not a legal conclusion: the OV_KaR chapter has no
 * notice newer than this date (last one K050040, OV 187/2025), while OV_KaV
 * keeps receiving notices in 2026. Verified against the live source on
 * OV_FACTS_VERIFIED_ON.
 */
export const OV_KAR_LAST_NOTICE = "30.09.2025";
export const OV_FACTS_VERIFIED_ON = "09.10.2026";
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
