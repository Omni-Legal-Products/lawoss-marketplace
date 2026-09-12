import { UnsupportedProviderError } from "../domain/errors.js";
import { exportWholeDecisionMarkdown } from "../infra/markdown-export.js";
import { readDecisionTextWindow } from "../domain/decision-text-cache.js";
export async function maybeBuildIncludedFullText(input) {
    if (!shouldIncludeFullText(input.request)) {
        return undefined;
    }
    const availability = input.decision.sourceAvailability;
    const canExtract = availability.textAvailable || availability.textDerivableFromDocument || availability.documentAvailable;
    if (!canExtract) {
        return undefined;
    }
    if (!input.provider.getDecisionText) {
        throw new UnsupportedProviderError(input.provider.id);
    }
    const exported = await exportWholeDecisionMarkdown({
        detail: input.decision,
        windowChars: 20000,
        maxCharsTotal: 500000,
        getTextWindow: ({ offsetChars, maxChars }) => readDecisionTextWindow({
            provider: input.decision.provider,
            id: input.decision.providerId,
            offsetChars,
            maxChars,
            // Called through the provider, never detached: the real providers reach
            // a private field, so a bare method reference loses `this` and throws.
            fetchWindow: (args) => input.provider.getDecisionText(args)
        })
    });
    return {
        markdown: exported.markdown,
        windowCount: exported.windowCount,
        complete: exported.complete,
        truncated: exported.truncated,
        continueFromOffset: exported.continueFromOffset,
        sourceMode: exported.sourceMode,
        textSha256: exported.textSha256
    };
}
export function shouldIncludeFullText(input) {
    return input.view === "full" || input.include.includes("fullText");
}
//# sourceMappingURL=detail-full-text.js.map