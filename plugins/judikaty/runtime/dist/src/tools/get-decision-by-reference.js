import { assertProviderAvailable, GetDecisionByReferenceInputSchema } from "../domain/provider-contracts.js";
import { buildDecisionFollowupActions, buildFullTextGuidance } from "../domain/decision-followups.js";
import { buildProviderNotAnsweredNote, buildReferenceFallbackBoundary, looksLikeConstitutionalCourtReference } from "../domain/fallback-boundary.js";
import { firstResolvedIdentity } from "../domain/merge.js";
import { presentDecisionDetail } from "../server/presenters.js";
import { asToolResult } from "../server/response.js";
import { maybeBuildIncludedFullText } from "./detail-full-text.js";
export function registerGetDecisionByReferenceTool(server, registry) {
    server.registerTool("get_decision_by_reference", {
        title: "Get Decision By Reference",
        description: "Resolve a decision by ECLI, spisova znacka, or provider-specific ID and return normalized decision detail. For long judgments, prefer get_decision_markdown_by_reference for windowed reading; view='full' may be large.",
        inputSchema: GetDecisionByReferenceInputSchema
    }, async (input) => {
        const parsed = GetDecisionByReferenceInputSchema.parse(input);
        const identity = await resolveByReference(parsed, registry);
        if (!identity.matched || !identity.provider || !identity.providerId) {
            const fallbackBoundary = buildReferenceFallbackBoundary({
                provider: parsed.provider,
                reference: parsed.reference,
                resolution: identity
            });
            return asToolResult({
                matched: false,
                reference: parsed.reference,
                notes: identity.notes,
                ...(fallbackBoundary ? { fallbackBoundary } : {})
            });
        }
        const provider = assertProviderAvailable(registry, identity.provider);
        const decision = await provider.getDecisionDetail({
            provider: identity.provider,
            id: identity.providerId,
            view: parsed.view,
            include: parsed.include
        });
        const fullText = await maybeBuildIncludedFullText({
            decision,
            provider,
            request: parsed
        });
        const recommendedNextActions = buildDecisionFollowupActions({
            provider: identity.provider,
            providerId: identity.providerId,
            reference: parsed.reference,
            sourceAvailability: decision.sourceAvailability
        });
        const fullTextGuidance = buildFullTextGuidance({
            provider: identity.provider,
            providerId: identity.providerId,
            reference: parsed.reference,
            sourceAvailability: decision.sourceAvailability
        });
        return asToolResult({
            matched: true,
            reference: parsed.reference,
            resolved: identity,
            decision: presentDecisionDetail(decision, parsed),
            ...(fullText ? { fullText } : {}),
            ...(fullTextGuidance ? { fullTextGuidance } : {}),
            ...(recommendedNextActions.length > 0 ? { recommendedNextActions } : {})
        });
    });
}
export async function resolveByReference(input, registry) {
    const parsedReference = parseDecisionReference(input.reference);
    const resolveInput = {
        provider: input.provider,
        ...parsedReference
    };
    if (input.provider === "auto") {
        const justice = registry.get("justice");
        const nsud = registry.get("nsud");
        if (!justice?.resolveDecisionIdentity || !nsud?.resolveDecisionIdentity) {
            throw new Error("Auto provider mode requires resolveDecisionIdentity in justice and nsud.");
        }
        const { resolution } = await resolveIdentityInAutoMode(parsedReference, registry, [
            justice,
            nsud
        ]);
        if (resolution.matched) {
            return resolution;
        }
        const fallbackBoundary = buildReferenceFallbackBoundary({
            provider: input.provider,
            reference: input.reference,
            resolution
        });
        return {
            ...resolution,
            notes: [...resolution.notes, ...(fallbackBoundary?.notes ?? [])]
        };
    }
    const provider = registry.get(input.provider);
    if (!provider?.resolveDecisionIdentity) {
        throw new Error(`Provider '${input.provider}' does not support resolveDecisionIdentity.`);
    }
    return provider.resolveDecisionIdentity(resolveInput);
}
/**
 * Auto-mode identity resolution shared by resolve_decision_identity and the
 * by-reference tools. Queries the given base providers (justice, nsud) and, for
 * Constitutional Court shaped references only (ÚS lookups are slow), ustavny too.
 * A provider that rejected or could not be queried is named in the notes, so a
 * miss is never presented as proof that the decision is unavailable.
 */
export async function resolveIdentityInAutoMode(input, registry, baseProviders) {
    const targets = [...baseProviders];
    const notes = [];
    if (looksLikeConstitutionalCourtReference(input.ecli ?? input.spisovaZnacka)) {
        const ustavny = registry.get("ustavny");
        if (ustavny?.resolveDecisionIdentity) {
            targets.push(ustavny);
        }
        else {
            notes.push(buildProviderNotAnsweredNote("ustavny", "it is not available in this server, so this Constitutional Court reference was not queried there"));
        }
    }
    const results = await Promise.allSettled(targets.map((provider) => {
        if (!provider.resolveDecisionIdentity) {
            return Promise.reject(new Error("resolveDecisionIdentity is not supported"));
        }
        return provider.resolveDecisionIdentity({ ...input, provider: provider.id });
    }));
    const answered = [];
    results.forEach((result, index) => {
        if (result.status === "fulfilled") {
            answered.push(result.value);
            return;
        }
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        notes.push(buildProviderNotAnsweredNote(targets[index]?.id ?? "unknown", reason));
    });
    const resolution = firstResolvedIdentity(answered);
    return {
        resolution: notes.length > 0 ? { ...resolution, notes: [...resolution.notes, ...notes] } : resolution,
        answered: answered.length
    };
}
function parseDecisionReference(reference) {
    const normalized = reference.trim();
    if (/^ECLI:/i.test(normalized)) {
        return { ecli: normalized };
    }
    if (/^\d{5,}$/.test(normalized) || isUuid(normalized)) {
        return { providerId: normalized };
    }
    return { spisovaZnacka: normalized };
}
function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
//# sourceMappingURL=get-decision-by-reference.js.map