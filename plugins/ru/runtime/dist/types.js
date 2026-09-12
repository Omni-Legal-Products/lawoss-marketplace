import { z } from "zod";
export const RU_ERROR_CODES = [
    "RU_INPUT",
    "RU_INPUT_TOO_LARGE",
    "RU_SOURCE_HTTP",
    "RU_SOURCE_REDIRECT",
    "RU_SOURCE_CONTENT_TYPE",
    "RU_SOURCE_SIZE",
    "RU_SOURCE_PARSE",
    "RU_SOURCE_TIMEOUT",
    "RU_INTERNAL",
];
export class RuMcpError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "RuMcpError";
    }
}
// ---------------------------------------------------------------------------
// Input schemas (zod) for the MCP tools
// ---------------------------------------------------------------------------
/**
 * ru_search input. The single full-text query matches debtor name, business
 * name, IČO and case number (sp. zn.), diacritics- and case-insensitive.
 */
export const ruSearchInputSchema = {
    /** Full-text query: debtor name / business name / IČO / case number. */
    query: z.string().min(1, "Zadaj vyhľadávací výraz (meno, obchodné meno, IČO alebo sp. zn.)."),
    /** Zero-based page index (default 0). */
    page: z.number().int().min(0).optional(),
    /** Page size (default 15). */
    pageSize: z.number().int().min(1).max(100).optional(),
};
/** ru_get_case input. */
export const ruGetCaseInputSchema = {
    /** konanieId from a ru_search result row. */
    konanieId: z.number().int().min(1),
};
export const ruGetByIcoInputSchema = {
    ico: z.string().regex(/^[0-9]{8}$/, "IČO must contain exactly eight ASCII digits."),
};
