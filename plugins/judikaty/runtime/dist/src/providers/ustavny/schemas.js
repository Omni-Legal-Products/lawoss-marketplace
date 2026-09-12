import * as z from "zod/v4";
const UstavnyStringOrArraySchema = z.union([z.string(), z.array(z.string())]).optional();
// The ÚS DMS sometimes returns a scalar text field as an array of strings for
// some documents (e.g. mkFileReference). Coerce array -> first element so a
// single odd document does not crash the whole page parse.
const flexString = z.preprocess((v) => (Array.isArray(v) ? (v[0] ?? null) : v), z.string().nullable().optional());
export const UstavnyDecisionItemSchema = z.object({
    documentId: z.string(),
    title: flexString,
    mkDocumentType: flexString,
    mkDateOfDecision: flexString,
    mkRSAPNumberOfFile: flexString,
    mkRVPNumberOfFile: flexString,
    mkTypeOfDecision: z.array(z.string()).optional().nullable(),
    mkDecisionInTermsOf: z.array(z.string()).optional().nullable(),
    mkECLI: flexString,
    mkDateOfLegalForce: flexString,
    mkPublicationDate: flexString,
    mkTypeOfProposer: z.array(z.string()).optional().nullable(),
    mkTypeOfProceeding: flexString,
    mkFormOfDecision: flexString,
    mkTypeOfNegotiation: z.array(z.string()).optional().nullable(),
    mkResultOfNegotiation: z.array(z.string()).optional().nullable(),
    mkCause: z.array(z.string()).optional().nullable(),
    mkWordRegister: z.array(z.string()).optional().nullable(),
    mkMaterialRegister: z.array(z.string()).optional().nullable(),
    mkComplainedLegalRegulation: z.array(z.string()).optional().nullable(),
    mkJudgeReporter: flexString,
    mkDifferentView: flexString,
    mkFileReference: flexString,
    mkReferences: z.array(z.string()).optional().nullable(),
    mkClauseTitle: flexString,
    mkClauseText: flexString,
    mkWebTitle: flexString,
    extension: flexString,
    size: z.number().optional().nullable(),
    contentType: flexString,
    content: flexString
});
export const UstavnySearchResponseSchema = z.object({
    numFound: z.number().int().nonnegative(),
    documents: z.array(UstavnyDecisionItemSchema).default([]),
    facetCount: z.record(z.string(), z.unknown()).optional()
});
export const UstavnyContentResponseSchema = z.object({
    content: z.string()
});
export const UstavnyAccessTokenSchema = z.object({
    access_token: z.string(),
    token_type: z.string().optional(),
    expires_in: z.number().optional()
});
export const UstavnyCodelistResponseSchema = z.object({
    codelist: z.record(z.string(), z.unknown()).default({})
});
export const _UstavnyStringOrArraySchema = UstavnyStringOrArraySchema;
//# sourceMappingURL=schemas.js.map