import { ResolveDecisionIdentityInputSchema, assertProviderAvailable, resolveSearchProvider } from "../domain/provider-contracts.js";
import { buildReferenceFallbackBoundary } from "../domain/fallback-boundary.js";
import { firstResolvedIdentity } from "../domain/merge.js";
import { UnsupportedProviderError } from "../domain/errors.js";
import { asToolResult } from "../server/response.js";
export function registerResolveDecisionIdentityTool(server, registry) {
    server.registerTool("resolve_decision_identity", {
        title: "Resolve Decision Identity",
        description: "Resolve ECLI, spisová značka, or provider ID into a normalized decision identity.",
        inputSchema: ResolveDecisionIdentityInputSchema
    }, async (input) => {
        const parsed = ResolveDecisionIdentityInputSchema.parse(input);
        if (parsed.provider === "auto") {
            const justice = assertProviderAvailable(registry, "justice");
            const nsud = assertProviderAvailable(registry, "nsud");
            if (!justice.resolveDecisionIdentity || !nsud.resolveDecisionIdentity) {
                throw new Error("Auto provider mode requires resolveDecisionIdentity in justice and nsud.");
            }
            const results = await Promise.allSettled([
                justice.resolveDecisionIdentity({ ...parsed, provider: "justice" }),
                nsud.resolveDecisionIdentity({ ...parsed, provider: "nsud" })
            ]);
            const successfulResults = results
                .filter((result) => result.status === "fulfilled")
                .map((result) => result.value);
            if (successfulResults.length === 0) {
                throw new Error("Auto provider mode could not resolve the decision identity.");
            }
            const resolution = firstResolvedIdentity(successfulResults);
            const fallbackBoundary = buildReferenceFallbackBoundary({
                provider: parsed.provider,
                reference: parsed.ecli ?? parsed.spisovaZnacka ?? parsed.providerId ?? "",
                resolution
            });
            return asToolResult({
                ...resolution,
                ...(resolution.matched || !fallbackBoundary ? {} : { fallbackBoundary })
            });
        }
        const provider = assertProviderAvailable(registry, resolveSearchProvider(parsed.provider));
        if (!provider.resolveDecisionIdentity) {
            throw new UnsupportedProviderError(provider.id);
        }
        const resolution = await provider.resolveDecisionIdentity(parsed);
        const fallbackBoundary = buildReferenceFallbackBoundary({
            provider: parsed.provider,
            reference: parsed.ecli ?? parsed.spisovaZnacka ?? parsed.providerId ?? "",
            resolution
        });
        return asToolResult({
            ...resolution,
            ...(resolution.matched || !fallbackBoundary ? {} : { fallbackBoundary })
        });
    });
}
//# sourceMappingURL=resolve-decision-identity.js.map