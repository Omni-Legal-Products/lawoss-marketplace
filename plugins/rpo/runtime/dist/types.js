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
/** A legal predecessor or successor record inside the entity detail. */
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
/** Legal status (CL010108), e.g. "Zaniknutá spoločnosť", "V likvidácii". */
export const LegalStatusSchema = z
    .object({
    value: CodelistValueSchema.optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
})
    .passthrough();
/**
 * Supervisory board members, procurators, partners, shareholders. A
 * stakeholder is either a natural person (personName) or a company
 * (fullName + identifier). stakeholderType.code is not unique across
 * codelists (99 = "Spoločník" here, "Predstavenstvo" in CL010113), so only
 * the label is used.
 */
export const StakeholderSchema = z
    .object({
    stakeholderType: CodelistValueSchema.optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
    address: AddressSchema.optional(),
    personName: PersonNameSchema.optional(),
    fullName: z.string().optional(),
    identifier: z.string().optional(),
})
    .passthrough();
/** Registered capital. RPO keeps the amount and the paid-up amount as separate records. */
export const EquitySchema = z
    .object({
    value: z.number().optional(),
    valuePaid: z.number().optional(),
    currency: CodelistValueSchema.optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
})
    .passthrough();
export const ShareSchema = z
    .object({
    shareType: CodelistValueSchema.optional(),
    shareForm: z.string().optional(),
    shareNominalValue: z.number().optional(),
    shareCurrency: CodelistValueSchema.optional(),
    /** Number of shares of this kind (ORSR "počet"). */
    amountOfFunds: z.number().optional(),
    transferability: z.string().optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
})
    .passthrough();
/** A partner's deposit (vklad) in an s.r.o. / k.s. */
export const DepositSchema = z
    .object({
    personName: PersonNameSchema.optional(),
    fullName: z.string().optional(),
    amount: z.number().optional(),
    currency: CodelistValueSchema.optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
})
    .passthrough();
/** Free-text records: manner of acting (authorizations), other legal facts. */
export const TextRecordSchema = HistoryValueSchema;
/** A single entity summary as returned inside `/search` results[]. */
export const EntitySummarySchema = z
    .object({
    id: z.number(),
    dbModificationDate: z.string().optional(),
    identifiers: z.array(HistoryValueSchema).optional(),
    fullNames: z.array(HistoryValueSchema).optional(),
    addresses: z.array(AddressSchema).optional(),
    establishment: z.string().optional(),
    termination: z.string().optional(),
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
    termination: z.string().optional(),
    legalStatuses: z.array(LegalStatusSchema).optional(),
    activities: z.array(ActivitySchema).optional(),
    statutoryBodies: z.array(StatutoryBodySchema).optional(),
    stakeholders: z.array(StakeholderSchema).optional(),
    otherLegalFacts: z.array(TextRecordSchema).optional(),
    authorizations: z.array(TextRecordSchema).optional(),
    equities: z.array(EquitySchema).optional(),
    shares: z.array(ShareSchema).optional(),
    deposits: z.array(DepositSchema).optional(),
    sourceRegister: SourceRegisterSchema.optional(),
    statisticalCodes: StatisticalCodesSchema.optional(),
    predecessors: RelatedEntityArraySchema,
    successors: RelatedEntityArraySchema,
    license: z.string().optional(),
})
    .passthrough();
