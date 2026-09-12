// Niektorí MCP klienti serializujú skalárne argumenty ako reťazce ("20",
// "false"). Holé z.number()/z.boolean() vtedy odmietnu celé volanie s
// -32602 "expected number, received string".
import { z } from "zod";
/**
 * Boolean accepting the literal strings "true"/"false".
 *
 * Deliberately NOT z.coerce.boolean(): that is plain JS truthiness, so the
 * string "false" becomes true. Here that would silently flip fresh (bypassing
 * the cache) or include_attachments (downloading every attachment).
 *
 * A factory, not a shared constant: this repo is on zod 3, whose JSON Schema
 * converter deduplicates IDENTICAL instances into a sibling "$ref". The server
 * copes; a client cannot, and every tool call then fails with nothing in the
 * logs. That is exactly how kalkulacky-sk-MCP#8 broke.
 */
export function looseBoolean() {
    return z.preprocess((v) => (typeof v === "string" ? (v === "true" ? true : v === "false" ? false : v) : v), z.boolean());
}
/**
 * Number accepting its string form. Refinements (.int(), .min(), ...) belong on
 * the inner schema — z.preprocess returns ZodEffects, which does not offer
 * them. An empty string is not zero: z.coerce.number() maps "" to 0, which
 * would turn an omitted cena_min into a real filter of 0 EUR.
 */
export function looseNumber(inner = z.number()) {
    return z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? Number.NaN : Number(v)) : v), inner);
}
//# sourceMappingURL=scalars.js.map