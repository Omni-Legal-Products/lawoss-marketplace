export function mergeSearchDecisionResults(results) {
    const seen = new Set();
    const items = [];
    const providerBreakdown = {};
    const coverageNotes = [];
    const coverageItems = [];
    let total = 0;
    for (const result of results) {
        total += result.total;
        for (const [provider, count] of Object.entries(result.providerBreakdown)) {
            providerBreakdown[provider] = (providerBreakdown[provider] ?? 0) + count;
        }
        coverageNotes.push(...result.coverageNotes);
        for (const item of result.items) {
            coverageItems.push(item);
            const key = decisionDedupKey(item);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            items.push(item);
        }
    }
    return {
        total,
        items,
        providerBreakdown,
        dedupApplied: items.length !== results.reduce((acc, result) => acc + result.items.length, 0),
        coverageNotes: [...new Set([...coverageNotes, ...buildMergedCoverageNotes(coverageItems)])]
    };
}
export function mergeAutocompleteItems(groups, limit) {
    const seen = new Set();
    const merged = [];
    for (const group of groups) {
        for (const item of group.items) {
            const key = item.ecli ? `ecli:${item.ecli}` : `${item.courtName}|${item.label}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            merged.push(item);
            if (merged.length >= limit) {
                return { items: merged };
            }
        }
    }
    return { items: merged };
}
export function firstResolvedIdentity(results) {
    return (results.find((result) => result.matched) ?? {
        matched: false,
        provider: null,
        providerId: null,
        ecli: null,
        spisovaZnacka: null,
        sourceUrl: null,
        notes: results.flatMap((result) => result.notes)
    });
}
function decisionDedupKey(item) {
    if (item.ecli) {
        return `ecli:${item.ecli}`;
    }
    if (item.spisovaZnacka && item.dateIssued && item.courtName) {
        return `case:${item.spisovaZnacka}|${item.dateIssued}|${item.courtName}`;
    }
    return `provider:${item.provider}|${item.providerId}`;
}
export function buildMergedCoverageNotes(items) {
    if (items.length === 0) {
        return [];
    }
    const byProvider = new Map();
    for (const item of items) {
        const bucket = byProvider.get(item.provider) ?? {
            textAvailable: 0,
            pdfAvailable: 0,
            metadataOnly: 0
        };
        switch (item.sourceAvailability?.status) {
            case "text_available":
                bucket.textAvailable += 1;
                break;
            case "pdf_available":
                bucket.pdfAvailable += 1;
                break;
            case "metadata_only":
            default:
                bucket.metadataOnly += 1;
                break;
        }
        byProvider.set(item.provider, bucket);
    }
    const notes = [...byProvider.entries()].map(([provider, counts]) => {
        const parts = [];
        if (counts.textAvailable > 0) {
            parts.push(`${counts.textAvailable} text-ready`);
        }
        if (counts.pdfAvailable > 0) {
            parts.push(`${counts.pdfAvailable} PDF-only`);
        }
        if (counts.metadataOnly > 0) {
            parts.push(`${counts.metadataOnly} metadata-only`);
        }
        return `${provider} results in this page: ${parts.join(", ")}.`;
    });
    const providersWithText = [...byProvider.entries()]
        .filter(([, counts]) => counts.textAvailable > 0)
        .map(([provider]) => provider);
    const providersWithoutText = [...byProvider.entries()]
        .filter(([, counts]) => counts.textAvailable === 0)
        .map(([provider]) => provider);
    if (providersWithText.length > 0 && providersWithoutText.length > 0) {
        notes.push(`${providersWithText.join(", ")} currently contributes text-ready results, while ${providersWithoutText.join(", ")} is limited to metadata/PDF coverage in this page.`);
    }
    return notes;
}
/**
 * Generic post-fetch guard: when the caller asked for a date range, every
 * item in the response MUST satisfy it. Some providers (NS SR in
 * particular) accept dateFrom/dateTo but silently ignore them upstream, so
 * this cannot be trusted to have already happened server-side.
 *
 * - Items whose dateIssued falls outside [dateFrom, dateTo] are dropped.
 * - Items with a missing/unparsable dateIssued are dropped too (never kept
 *   as if verified) when a date range was requested.
 * - `total` is never left claiming more than what was actually verified in
 *   this response; the provider's raw upstream total is preserved in a
 *   coverage note (not silently discarded) rather than presented as-is.
 *
 * A no-op (same reference returned) when no date range was requested, or
 * when every item already verified as in-range -- so well-behaved providers
 * (justice, ustavny) pay no cost and get no spurious notes.
 */
export function applyDateRangeGuard(result, input, providerId) {
    const dateFrom = parseIsoDateOnly(input.dateFrom);
    const dateTo = parseIsoDateOnly(input.dateTo);
    if (!dateFrom && !dateTo) {
        return result;
    }
    const kept = [];
    let droppedOutOfRange = 0;
    let droppedMissingDate = 0;
    for (const item of result.items) {
        const issued = parseIsoDateOnly(item.dateIssued);
        if (issued === null) {
            droppedMissingDate += 1;
            continue;
        }
        if ((dateFrom !== null && issued < dateFrom) || (dateTo !== null && issued > dateTo)) {
            droppedOutOfRange += 1;
            continue;
        }
        kept.push(item);
    }
    if (droppedOutOfRange === 0 && droppedMissingDate === 0) {
        return result;
    }
    // `total` is only rewritten when the provider has been PROVEN unreliable
    // in this same pass (it returned rows genuinely outside the requested
    // range). A missing/unparsable dateIssued on an otherwise-verified page
    // is not proof of that -- a well-behaved provider (justice, ustavny) can
    // legitimately report a true total spanning many more pages than the one
    // in hand, and rewriting it down to this page's local count would make
    // any offset beyond the rewritten total look out-of-bounds when it isn't.
    const totalIsProvenUnreliable = droppedOutOfRange > 0;
    const rangeDescription = `dateFrom=${dateFrom ?? "(none)"} dateTo=${dateTo ?? "(none)"}`;
    const notes = [];
    if (droppedOutOfRange > 0) {
        notes.push(`${providerId}: ${droppedOutOfRange} of its ${result.items.length} returned result(s) fell outside the requested date range (${rangeDescription}) even though it was requested; ${providerId}'s upstream date filtering is unreliable, so the range was enforced locally and those rows were dropped.`);
        notes.push(`${providerId} reported total=${result.total} upstream for this query, but that count was not verified against the requested date range and ${providerId}'s upstream date filtering has now been shown to be unreliable; total was adjusted to the ${kept.length} locally verified row(s) in this response.`);
    }
    if (droppedMissingDate > 0) {
        notes.push(`${providerId}: dropped ${droppedMissingDate} result(s) with a missing or unparsable dateIssued, since a date range was requested (${rangeDescription}) and their date could not be verified against it.` +
            (totalIsProvenUnreliable
                ? ""
                : ` total is left as upstream-reported (${result.total}), since this alone does not show ${providerId}'s date filtering is unreliable.`));
    }
    return {
        ...result,
        items: kept,
        providerBreakdown: {
            ...result.providerBreakdown,
            [providerId]: kept.length
        },
        total: totalIsProvenUnreliable ? kept.length : result.total,
        coverageNotes: [...result.coverageNotes, ...notes]
    };
}
/**
 * Parses a strict ISO calendar date (YYYY-MM-DD), rejecting both malformed
 * strings and impossible calendar dates (e.g. 2026-02-31) via a UTC
 * round-trip: Date normalizes an out-of-range day/month by rolling over
 * into the next one, so a mismatch after round-tripping means the input
 * wasn't a real date.
 *
 * Exported so other date-range verification (e.g.
 * `tools/search-decisions/hydration-date-guard.ts`'s post-hydration check)
 * uses the exact same calendar-validity rules as this guard, rather than a
 * second slightly-different parser drifting out of sync with this one.
 */
export function parseIsoDateOnly(value) {
    if (!value) {
        return null;
    }
    const trimmed = value.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (!match) {
        return null;
    }
    const [, year, month, day] = match;
    const yearNum = Number(year);
    const monthNum = Number(month);
    const dayNum = Number(day);
    if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
        return null;
    }
    const roundTripped = new Date(Date.UTC(yearNum, monthNum - 1, dayNum));
    if (roundTripped.getUTCFullYear() !== yearNum ||
        roundTripped.getUTCMonth() !== monthNum - 1 ||
        roundTripped.getUTCDate() !== dayNum) {
        return null;
    }
    return `${year}-${month}-${day}`;
}
//# sourceMappingURL=merge.js.map