import { looseNumber } from "./scalars.js";
import * as z from "zod/v4";
import { assertProviderAvailable, resolveSearchProvider } from "../domain/provider-contracts.js";
import { mergeAutocompleteItems } from "../domain/merge.js";
import { UnsupportedProviderError } from "../domain/errors.js";
import { asToolResult } from "../server/response.js";
const AutocompleteDecisionsInputSchema = z.object({
    provider: z.enum(["auto", "justice", "nsud", "ustavny"]).default("auto"),
    query: z.string().trim().min(1),
    courtId: z.string().optional(),
    limit: looseNumber(z.number().int().min(1).max(20)).default(10)
});
export function registerAutocompleteDecisionsTool(server, registry) {
    server.registerTool("autocomplete_decisions", {
        title: "Autocomplete Decisions",
        description: "Provide compact decision suggestions for spisová značka or identifier lookup.",
        inputSchema: AutocompleteDecisionsInputSchema
    }, async (input) => {
        const parsed = AutocompleteDecisionsInputSchema.parse(input);
        return asToolResult(await runAutocompleteDecisions(parsed, registry));
    });
}
export async function runAutocompleteDecisions(input, registry) {
    if (input.provider === "auto") {
        const justice = assertProviderAvailable(registry, "justice");
        const nsud = assertProviderAvailable(registry, "nsud");
        const providers = [
            {
                id: justice.id,
                run: justice.autocompleteDecisions
                    ? () => justice.autocompleteDecisions({
                        query: input.query,
                        ...(input.courtId ? { courtId: input.courtId } : {}),
                        limit: input.limit
                    })
                    : null
            },
            {
                id: nsud.id,
                run: nsud.autocompleteDecisions
                    ? () => nsud.autocompleteDecisions({
                        query: input.query,
                        limit: input.limit
                    })
                    : null
            }
        ];
        const runnableProviders = providers.filter((provider) => provider.run !== null);
        if (runnableProviders.length === 0) {
            throw new Error("Auto provider mode requires autocompleteDecisions in justice and nsud.");
        }
        const settled = await Promise.allSettled(runnableProviders.map((provider) => provider.run()));
        const successful = [];
        const failures = [];
        for (const [index, result] of settled.entries()) {
            if (result.status === "fulfilled") {
                successful.push(result.value);
                continue;
            }
            failures.push(`${runnableProviders[index].id}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
        }
        if (successful.length > 0) {
            const merged = mergeAutocompleteItems(successful, Number.MAX_SAFE_INTEGER);
            return {
                items: rankAutocompleteItems(merged.items, input.query).slice(0, input.limit)
            };
        }
        throw new Error(`Autocomplete failed for all auto providers. ${failures.join(" | ")}`);
    }
    const provider = assertProviderAvailable(registry, resolveSearchProvider(input.provider));
    if (!provider.autocompleteDecisions) {
        throw new UnsupportedProviderError(provider.id);
    }
    return provider.autocompleteDecisions({
        query: input.query,
        ...(input.courtId ? { courtId: input.courtId } : {}),
        limit: input.limit
    });
}
function rankAutocompleteItems(items, query) {
    const normalizedQuery = normalizeAutocompleteValue(query);
    return [...items].sort((left, right) => {
        const leftScore = scoreAutocompleteItem(left, normalizedQuery);
        const rightScore = scoreAutocompleteItem(right, normalizedQuery);
        if (leftScore !== rightScore) {
            return rightScore - leftScore;
        }
        return left.label.localeCompare(right.label, "sk");
    });
}
function scoreAutocompleteItem(item, normalizedQuery) {
    const normalizedLabel = normalizeAutocompleteValue(item.label);
    const normalizedEcli = item.ecli ? normalizeAutocompleteValue(item.ecli) : "";
    if (normalizedLabel === normalizedQuery || normalizedEcli === normalizedQuery) {
        return 4;
    }
    if (normalizedLabel.startsWith(normalizedQuery)) {
        return 3;
    }
    if (normalizedLabel.includes(normalizedQuery) || normalizedEcli.includes(normalizedQuery)) {
        return 2;
    }
    return 1;
}
function normalizeAutocompleteValue(value) {
    return value.trim().toLowerCase().replace(/\s+/g, "");
}
//# sourceMappingURL=autocomplete-decisions.js.map