import * as z from "zod/v4";
import { CourtSchema, DecisionSummarySchema, ProviderIdSchema, SearchMetaSchema, SearchProviderSchema } from "./models.js";
/**
 * Strict ISO calendar date (YYYY-MM-DD), format AND calendar-validity both
 * enforced (z.iso.date()'s pattern already accounts for per-month day
 * counts and leap years, e.g. it rejects 2026-02-31 and non-leap 2026-02-29
 * on its own). A malformed or impossible bound is rejected here with a
 * clear message instead of silently passing through unverified: previously
 * a bare z.string() let e.g. dateFrom="1.6.2026" both get sent upstream
 * as-is AND fail every local date-range verification (parseIsoDateOnly in
 * domain/merge.ts also returns null for it), disabling the whole
 * post-fetch guard without any indication why.
 */
function isoDateField(fieldLabel) {
    return z.iso.date({
        error: `${fieldLabel} must be an ISO calendar date in YYYY-MM-DD format (e.g. 2026-06-01)`
    });
}
export const SearchDecisionsInputSchema = z.object({
    query: z.string().trim().min(1).optional(),
    provider: SearchProviderSchema.default("auto"),
    courtId: z.string().optional(),
    courtType: z.string().optional(),
    courtName: z.string().optional(),
    ecli: z.string().optional(),
    spisovaZnacka: z.string().optional(),
    identifikacneCisloSpisu: z.string().optional(),
    dateFrom: isoDateField("dateFrom").optional(),
    dateTo: isoDateField("dateTo").optional(),
    legalArea: z.string().optional(),
    legalSubArea: z.string().optional(),
    decisionForm: z.string().optional(),
    decisionNature: z.string().optional(),
    citedLaw: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(10),
    offset: z.number().int().min(0).default(0),
    view: z.enum(["compact", "standard", "full"]).default("compact")
});
export const SearchDecisionsResultSchema = SearchMetaSchema.extend({
    items: z.array(DecisionSummarySchema)
});
export const GetDecisionDetailInputSchema = z.object({
    provider: ProviderIdSchema,
    id: z.string().min(1),
    view: z.enum(["compact", "standard", "full"]).default("standard"),
    include: z
        .array(z.enum(["document", "citedRegulations", "relatedCase", "textPreview", "fullText", "treatment"]))
        .default([])
});
export const GetDecisionByReferenceInputSchema = z.object({
    provider: SearchProviderSchema.default("auto"),
    reference: z.string().trim().min(1),
    view: z.enum(["compact", "standard", "full"]).default("standard"),
    include: z
        .array(z.enum(["document", "citedRegulations", "relatedCase", "textPreview", "fullText", "treatment"]))
        .default([])
});
export const GetDecisionMarkdownByReferenceInputSchema = z.object({
    provider: SearchProviderSchema.default("auto"),
    reference: z.string().trim().min(1),
    maxChars: z.number().int().min(1000).max(30000).default(12000),
    offsetChars: z.number().int().min(0).default(0)
});
export const ExportDecisionMarkdownByReferenceInputSchema = z.object({
    provider: SearchProviderSchema.default("auto"),
    reference: z.string().trim().min(1),
    windowChars: z.number().int().min(1000).max(30000).default(20000),
    maxCharsTotal: z.number().int().min(1000).max(500000).default(500000),
    saveToDefaultPath: z.boolean().default(false),
    savePath: z.string().optional()
});
export const ExportDecisionMarkdownInputSchema = z.object({
    provider: ProviderIdSchema,
    id: z.string().min(1),
    windowChars: z.number().int().min(1000).max(30000).default(20000),
    maxCharsTotal: z.number().int().min(1000).max(500000).default(500000),
    saveToDefaultPath: z.boolean().default(false),
    savePath: z.string().optional()
});
export const SearchCourtsInputSchema = z.object({
    provider: z.enum(["auto", "justice"]).default("auto"),
    query: z.string().trim().optional(),
    courtType: z.string().optional(),
    region: z.string().optional(),
    district: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).default(0)
});
export const SearchCourtsResultSchema = z.object({
    total: z.number().int().nonnegative(),
    items: z.array(CourtSchema)
});
export const ResolveDecisionIdentityInputSchema = z.object({
    provider: SearchProviderSchema.default("auto"),
    ecli: z.string().optional(),
    spisovaZnacka: z.string().optional(),
    providerId: z.string().optional()
});
export const ResolveDecisionIdentityResultSchema = z.object({
    matched: z.boolean(),
    provider: ProviderIdSchema.nullable(),
    providerId: z.string().nullable(),
    ecli: z.string().nullable(),
    spisovaZnacka: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    notes: z.array(z.string()).default([])
});
export const BatchGetDecisionSummariesInputSchema = z.object({
    items: z
        .array(z.object({
        provider: ProviderIdSchema,
        id: z.string().min(1)
    }))
        .min(1)
        .max(20),
    view: z.enum(["compact", "standard", "full"]).default("compact")
});
export const FindDecisionsByLawInputSchema = z.object({
    provider: z.enum(["auto", "justice", "nsud"]).default("auto"),
    law: z.string().min(1),
    paragraph: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).default(0),
    view: z.enum(["compact", "standard", "full"]).default("compact")
});
export const RelatedSlovlexContextInputSchema = z.object({
    provider: ProviderIdSchema,
    id: z.string().min(1)
});
export const RelatedSlovlexContextResultSchema = z.object({
    decision: z.object({
        provider: ProviderIdSchema,
        providerId: z.string(),
        ecli: z.string().nullable(),
        courtName: z.string(),
        spisovaZnacka: z.string().nullable(),
        dateIssued: z.string().nullable()
    }),
    citedRegulations: z.array(z.object({
        label: z.string(),
        url: z.string().nullable()
    }))
});
export const DownloadDecisionDocumentInputSchema = z.object({
    provider: ProviderIdSchema,
    id: z.string().min(1)
});
export const DownloadDecisionDocumentResultSchema = z.object({
    provider: ProviderIdSchema,
    id: z.string(),
    fileName: z.string().nullable(),
    contentType: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    savedPath: z.string().nullable(),
    sizeBytes: z.number().nullable()
});
export const GetDecisionTextInputSchema = z.object({
    provider: ProviderIdSchema,
    id: z.string().min(1),
    maxChars: z.number().int().min(1000).max(30000).default(12000),
    offsetChars: z.number().int().min(0).default(0)
});
export const ProviderCapabilitySchema = z.object({
    search: z.boolean(),
    detail: z.boolean(),
    text: z.boolean(),
    document: z.boolean(),
    lawSearch: z.boolean(),
    slovlexContext: z.boolean(),
    recentPolling: z.boolean(),
    courtSearch: z.boolean(),
    identityResolution: z.boolean(),
    autocomplete: z.boolean()
});
export const ProviderCoverageProfileSchema = z.object({
    courts: z.array(z.string()).default([]),
    textAvailability: z.enum(["metadata_only", "pdf_extract", "inline_text", "mixed"]),
    documentAvailability: z.enum(["none", "partial", "common"]),
    historicalCoverage: z.enum(["limited", "partial", "strong"]),
    notes: z.array(z.string()).default([])
});
export const ProviderHealthSchema = z.object({
    provider: ProviderIdSchema,
    available: z.boolean(),
    checkedAt: z.string(),
    capabilities: ProviderCapabilitySchema,
    coverage: ProviderCoverageProfileSchema,
    notes: z.array(z.string()).default([])
});
export const GetProviderHealthResultSchema = z.object({
    items: z.array(ProviderHealthSchema)
});
export const PollRecentDecisionsInputSchema = z.object({
    provider: z.enum(["auto", "justice", "nsud"]).default("auto"),
    sinceDate: isoDateField("sinceDate").optional(),
    limit: z.number().int().min(1).max(50).default(10)
});
export function assertProviderAvailable(registry, providerId) {
    const provider = registry.get(providerId);
    if (!provider) {
        throw new Error(`Provider '${providerId}' is not registered.`);
    }
    return provider;
}
export function resolveSearchProvider(provider) {
    if (provider === "auto") {
        return "justice";
    }
    return provider;
}
//# sourceMappingURL=provider-contracts.js.map