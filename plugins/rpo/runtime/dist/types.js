import { z } from "zod";
// ---------------------------------------------------------------------------
// Raw API shapes (RPO REST/JSON — https://api.statistics.sk/rpo/v1/)
//
// The RPO payloads are history-rich: identifiers, fullNames, addresses and
// legalForms are arrays of records carrying validFrom / validTo. The current
// value is the entry with no validTo (or the latest validFrom). The codelist
// pattern { value, code, codelistCode } recurs for categorical fields.
//
// Schemas below are permissive (.passthrough where useful, most fields
// optional) because the live API trims/extends records per request; we only
// pin the fields the normalization layer reads.
// ---------------------------------------------------------------------------
export const CodelistValueSchema = z
    .object({
    value: z.string().optional(),
    code: z.string().optional(),
    codelistCode: z.string().optional(),
})
    .passthrough();
export const HistoryValueSchema = z
    .object({
    value: z.string().optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
})
    .passthrough();
export const AddressSchema = z
    .object({
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
    street: z.string().optional(),
    buildingNumber: z.string().optional(),
    regNumber: z.number().optional(),
    postalCodes: z.array(z.string()).optional(),
    municipality: CodelistValueSchema.optional(),
    country: CodelistValueSchema.optional(),
})
    .passthrough();
export const SourceRegisterSchema = z
    .object({
    value: CodelistValueSchema.optional(),
    registrationOffices: z.array(HistoryValueSchema).optional(),
    registrationNumbers: z.array(HistoryValueSchema).optional(),
})
    .passthrough();
export const LegalFormSchema = z
    .object({
    value: CodelistValueSchema.optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
})
    .passthrough();
export const ActivitySchema = z
    .object({
    economicActivityDescription: z.string().optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
})
    .passthrough();
export const PersonNameSchema = z
    .object({
    formatedName: z.string().optional(),
    familyNames: z.array(z.string()).optional(),
    givenNames: z.array(z.string()).optional(),
})
    .passthrough();
export const StatutoryBodySchema = z
    .object({
    stakeholderType: CodelistValueSchema.optional(),
    statutoryBodyMember: CodelistValueSchema.optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
    address: AddressSchema.optional(),
    personName: PersonNameSchema.optional(),
    companyName: z.string().optional(),
})
    .passthrough();
export const StatisticalCodesSchema = z
    .object({
    statCodesActualization: z.string().optional(),
    mainActivity: CodelistValueSchema.optional(),
    esa2010: CodelistValueSchema.optional(),
})
    .passthrough();
export const RelatedEntityRecordSchema = z
    .object({
    identifier: z.string().optional(),
    fullName: z.string().optional(),
    address: AddressSchema.optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
})
    .passthrough();
const RelatedEntityArraySchema = z.preprocess((value) => Array.isArray(value) ? value : [], z.array(RelatedEntityRecordSchema));
/** A single entity summary as returned inside `/search` results[]. */
export const EntitySummarySchema = z
    .object({
    id: z.number(),
    dbModificationDate: z.string().optional(),
    identifiers: z.array(HistoryValueSchema).optional(),
    fullNames: z.array(HistoryValueSchema).optional(),
    addresses: z.array(AddressSchema).optional(),
    establishment: z.string().optional(),
    sourceRegister: SourceRegisterSchema.optional(),
})
    .passthrough();
/** `/search` envelope. `license` is a CC-BY text present on every response. */
export const SearchResponseSchema = z
    .object({
    results: z.array(EntitySummarySchema).optional(),
    license: z.string().optional(),
})
    .passthrough();
/** `/entity/{id}` full detail record. */
export const EntityDetailSchema = z
    .object({
    id: z.number(),
    dbModificationDate: z.string().optional(),
    identifiers: z.array(HistoryValueSchema).optional(),
    fullNames: z.array(HistoryValueSchema).optional(),
    addresses: z.array(AddressSchema).optional(),
    legalForms: z.array(LegalFormSchema).optional(),
    establishment: z.string().optional(),
    activities: z.array(ActivitySchema).optional(),
    statutoryBodies: z.array(StatutoryBodySchema).optional(),
    stakeholders: z.array(z.unknown()).optional(),
    otherLegalFacts: z.array(z.unknown()).optional(),
    authorizations: z.array(z.unknown()).optional(),
    equities: z.array(z.unknown()).optional(),
    shares: z.array(z.unknown()).optional(),
    sourceRegister: SourceRegisterSchema.optional(),
    statisticalCodes: StatisticalCodesSchema.optional(),
    predecessors: RelatedEntityArraySchema,
    successors: RelatedEntityArraySchema,
    license: z.string().optional(),
})
    .passthrough();
