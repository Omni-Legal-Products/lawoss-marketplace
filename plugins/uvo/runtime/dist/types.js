import { z } from "zod";
import { looseNumber } from "./scalars.js";
const boundedText = z.string().min(1).max(256);
// ---------------------------------------------------------------------------
// Input schemas (zod) for the MCP tools
// ---------------------------------------------------------------------------
/**
 * uvo_search input — maps to GET params of
 * /vyhladavanie/vyhladavanie-zakaziek. All filters optional; at least one of
 * ico / authorityName / contractName / cpv / nuts is required by the tool
 * handler (an empty query returns the whole vestník, newest first).
 */
export const uvoSearchInputSchema = {
    /** Contracting-authority IČO (obstarIco). Server-side filter — most reliable. */
    ico: z.string().min(1).max(32).optional(),
    /** Contracting-authority name (obstarNazov), e.g. "nemocnica". */
    authorityName: boundedText.optional(),
    /** Contract / tender name (nazovZakazky). */
    contractName: boundedText.optional(),
    /** CPV code (cpv), e.g. "39100000-3". */
    cpv: boundedText.optional(),
    /** NUTS region code (nut), e.g. "SK031". */
    nuts: boundedText.optional(),
    /** Contract type (druhZakazky): tovary | sluzby | stavebne prace. */
    contractType: z.enum(["tovary", "sluzby", "stavebne prace"]).optional(),
    /** Update window in days (datumAktualizacie): 7 | 31 | 365. */
    updatedWithinDays: z.preprocess((value) => typeof value === "string" && value.trim() !== "" ? Number(value) : value, z.union([z.literal(7), z.literal(31), z.literal(365)])).optional(),
    /** Page number (pageNo, 1-based). */
    page: looseNumber(z.number().int().min(1).max(20)).optional(),
};
/** uvo_get_notice input. */
export const uvoGetNoticeInputSchema = {
    /** Internal numeric notice (oznámenie) id, e.g. "588383". */
    noticeId: z.string().min(1).max(32),
};
