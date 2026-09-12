// Niektorí MCP klienti serializujú skalárne argumenty ako reťazce ("10").
// Holé z.number() vtedy odmietne celé volanie s -32602
// "expected number, received string".
import { z } from "zod";
/**
 * Number accepting its string form.
 *
 * Refinements (.int(), .min(), .max(), .default()) belong on the inner schema —
 * z.preprocess returns ZodEffects, which does not offer them.
 *
 * An empty string is not zero: z.coerce.number() maps "" to 0, which would turn
 * an omitted offset into an explicit 0 and an omitted limit into an invalid one.
 *
 * A factory, not a shared constant: with zod 3 the JSON Schema converter
 * deduplicates IDENTICAL instances into a sibling "$ref" that clients cannot
 * resolve — that is how kalkulacky-sk-MCP#8 broke. This repo is on zod 4, which
 * inlines, but the habit costs nothing.
 */
export function looseNumber(inner = z.number()) {
    return z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? Number.NaN : Number(v)) : v), inner);
}
//# sourceMappingURL=scalars.js.map