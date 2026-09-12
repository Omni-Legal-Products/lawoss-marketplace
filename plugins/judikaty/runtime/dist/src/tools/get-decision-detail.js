import { buildDecisionFollowupActions, buildFullTextGuidance } from "../domain/decision-followups.js";
import { GetDecisionDetailInputSchema, assertProviderAvailable } from "../domain/provider-contracts.js";
import { presentDecisionDetail } from "../server/presenters.js";
import { asToolResult } from "../server/response.js";
import { maybeBuildIncludedFullText } from "./detail-full-text.js";
import { maybeBuildDecisionTreatment } from "./detail-treatment.js";
export function registerGetDecisionDetailTool(server, registry) {
    server.registerTool("get_decision_detail", {
        title: "Get Decision Detail",
        description: "Return normalized metadata for one Slovak court decision. For long judgments, prefer get_decision_markdown for windowed reading; view='full' may be large.",
        inputSchema: GetDecisionDetailInputSchema
    }, async (input) => {
        const parsed = GetDecisionDetailInputSchema.parse(input);
        const provider = assertProviderAvailable(registry, parsed.provider);
        const decision = await provider.getDecisionDetail(parsed);
        const fullText = await maybeBuildIncludedFullText({
            decision,
            provider,
            request: parsed
        });
        const treatment = await maybeBuildDecisionTreatment({
            spisovaZnacka: decision.spisovaZnacka,
            include: parsed.include
        });
        const recommendedNextActions = buildDecisionFollowupActions({
            provider: parsed.provider,
            providerId: parsed.id,
            sourceAvailability: decision.sourceAvailability
        });
        const fullTextGuidance = buildFullTextGuidance({
            provider: parsed.provider,
            providerId: parsed.id,
            sourceAvailability: decision.sourceAvailability
        });
        return asToolResult({
            decision: presentDecisionDetail(decision, parsed),
            ...(fullText ? { fullText } : {}),
            ...(treatment ? { treatment } : {}),
            ...(fullTextGuidance ? { fullTextGuidance } : {}),
            ...(recommendedNextActions.length > 0 ? { recommendedNextActions } : {})
        });
    });
}
//# sourceMappingURL=get-decision-detail.js.map