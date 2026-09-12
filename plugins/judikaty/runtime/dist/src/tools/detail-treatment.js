// src/tools/detail-treatment.ts
import { buildDecisionTreatment } from "./get-decision-treatment.js";
/**
 * Build the treatment annotation for get_decision_detail when the caller opts in
 * via include: ["treatment"]. Returns null when not requested or when the
 * decision has no spisovaZnacka to key the reverse lookup on. Reads only the
 * local relations index (no network).
 */
export async function maybeBuildDecisionTreatment(input) {
    if (!input.include.includes("treatment"))
        return null;
    const ref = input.spisovaZnacka?.trim();
    if (!ref)
        return null;
    return buildDecisionTreatment({ spisovaZnacka: ref });
}
//# sourceMappingURL=detail-treatment.js.map