import * as z from "zod/v4";
export const ProviderIdSchema = z.enum(["justice", "nsud", "ustavny"]);
export const SearchProviderSchema = z.enum(["auto", "justice", "nsud", "ustavny"]);
export const SourceCompletenessSchema = z.enum([
    "metadata",
    "metadata_text",
    "metadata_document",
    "metadata_text_document"
]);
export const NormalizationConfidenceSchema = z.enum(["high", "medium", "low"]);
export const SourceAvailabilitySchema = z.object({
    metadataAvailable: z.literal(true),
    documentAvailable: z.boolean(),
    textAvailable: z.boolean(),
    textDerivableFromDocument: z.boolean(),
    textSourceMode: z.enum(["none", "inline", "pdf_extract"]),
    status: z.enum(["metadata_only", "pdf_available", "text_available"])
});
export const SourceProvenanceSchema = z.object({
    originSystem: z.string(),
    originType: z.enum([
        "official_api",
        "official_web",
        "official_dms",
        "public_dataset",
        "inline_text",
        "pdf_extract"
    ]),
    official: z.boolean(),
    collection: z.string().nullable().default(null),
    fallbackSuggested: z.boolean(),
    fallbackReason: z.string().nullable().default(null)
});
export const CourtSchema = z.object({
    provider: ProviderIdSchema,
    providerId: z.string(),
    name: z.string(),
    type: z.string().nullable().default(null),
    region: z.string().nullable().default(null),
    district: z.string().nullable().default(null),
    address: z.string().nullable().default(null),
    coordinates: z.object({
        lat: z.number().nullable(),
        lon: z.number().nullable()
    })
});
export const DecisionSummarySchema = z.object({
    provider: ProviderIdSchema,
    providerId: z.string(),
    ecli: z.string().nullable().default(null),
    courtName: z.string(),
    courtId: z.string().nullable().default(null),
    courtType: z.string().nullable().default(null),
    spisovaZnacka: z.string().nullable().default(null),
    identifikacneCisloSpisu: z.string().nullable().default(null),
    decisionForm: z.string().nullable().default(null),
    decisionNature: z.array(z.string()).default([]),
    dateIssued: z.string().nullable().default(null),
    judgeName: z.string().nullable().default(null),
    legalAreas: z.array(z.string()).default([]),
    legalSubAreas: z.array(z.string()).default([]),
    title: z.string().nullable().default(null),
    summary: z.string().nullable().default(null),
    documentUrl: z.string().nullable().default(null),
    sourceUrl: z.string().nullable().default(null),
    updatedAt: z.string().nullable().default(null),
    retrievedAt: z.string(),
    sourceAvailability: SourceAvailabilitySchema,
    sourceProvenance: SourceProvenanceSchema,
    sourceCompleteness: SourceCompletenessSchema,
    availabilityNotes: z.array(z.string()).default([]),
    normalizationConfidence: NormalizationConfidenceSchema
});
export const CitedRegulationSchema = z.object({
    label: z.string(),
    url: z.string().nullable().default(null),
    slovLexLawId: z.string().nullable().default(null),
    slovLexAnchor: z.string().nullable().default(null)
});
export const DecisionDetailSchema = z.object({
    provider: ProviderIdSchema,
    providerId: z.string(),
    ecli: z.string().nullable().default(null),
    court: z.object({
        id: z.string().nullable().default(null),
        name: z.string(),
        type: z.string().nullable().default(null),
        address: z.string().nullable().default(null)
    }),
    judge: z.object({
        id: z.string().nullable().default(null),
        name: z.string().nullable().default(null)
    }),
    spisovaZnacka: z.string().nullable().default(null),
    identifikacneCisloSpisu: z.string().nullable().default(null),
    dateIssued: z.string().nullable().default(null),
    decisionForm: z.string().nullable().default(null),
    decisionNature: z.array(z.string()).default([]),
    legalAreas: z.array(z.string()).default([]),
    legalSubAreas: z.array(z.string()).default([]),
    merit: z.string().nullable().default(null),
    textContent: z.string().nullable().default(null),
    document: z.object({
        name: z.string().nullable().default(null),
        extension: z.string().nullable().default(null),
        sizeBytes: z.number().nullable().default(null),
        url: z.string().nullable().default(null)
    }),
    citedRegulations: z.array(CitedRegulationSchema).default([]),
    relatedCase: z.object({
        originalCourt: z.string().nullable().default(null),
        originalCaseRef: z.string().nullable().default(null)
    }),
    source: z.object({
        provider: z.string(),
        retrievedAt: z.string(),
        sourceUrl: z.string().nullable().default(null)
    }),
    sourceAvailability: SourceAvailabilitySchema,
    sourceProvenance: SourceProvenanceSchema,
    sourceCompleteness: SourceCompletenessSchema,
    availabilityNotes: z.array(z.string()).default([]),
    normalizationConfidence: NormalizationConfidenceSchema
});
export const TextWindowSchema = z.object({
    provider: ProviderIdSchema,
    id: z.string(),
    text: z.string(),
    windowComplete: z.boolean(),
    nextOffset: z.number().nullable().default(null),
    sourceMode: z.enum(["inline", "pdf_extract"]),
    textSha256: z.string().nullable().default(null)
});
export const SearchMetaSchema = z.object({
    total: z.number().int().nonnegative(),
    providerBreakdown: z.record(z.string(), z.number().int().nonnegative()).default({}),
    dedupApplied: z.boolean().default(false),
    coverageNotes: z.array(z.string()).default([])
});
//# sourceMappingURL=models.js.map