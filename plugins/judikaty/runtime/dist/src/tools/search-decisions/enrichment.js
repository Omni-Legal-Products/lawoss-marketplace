import { readNsudDecisionText } from "../../providers/nsud/law-index-store.js";
import { canAttemptTextExtraction } from "./readability.js";
import { buildWebFallback } from "./web-fallback.js";
const MAX_READABLE_CANDIDATES = 3;
const MAX_BLOCKED_CANDIDATES = 3;
const PREVIEW_WINDOW_CHARS = 1400;
const SNIPPET_CONTEXT_CHARS = 240;
export async function buildSearchEnrichment(result, registry, input) {
    const readabilitySummary = summarizeReadability(result.items);
    const queryTokens = extractQueryTokens(input.query ?? null);
    const readingReadyMatches = await buildReadableMatches(result.items, registry, queryTokens);
    const blockedMatches = buildBlockedMatches(result.items);
    const webSearchFallback = readingReadyMatches.length === 0 && blockedMatches.length > 0
        ? await buildWebFallback(blockedMatches)
        : null;
    return {
        readabilitySummary,
        ...(readingReadyMatches.length > 0 ? { readingReadyMatches } : {}),
        ...(blockedMatches.length > 0 ? { readingBlockedMatches: blockedMatches } : {}),
        ...(webSearchFallback ? { webSearchFallback } : {})
    };
}
function summarizeReadability(items) {
    return items.reduce((acc, item) => {
        switch (item.sourceAvailability.status) {
            case "text_available":
                acc.textReady += 1;
                break;
            case "pdf_available":
                acc.pdfReady += 1;
                break;
            case "metadata_only":
            default:
                acc.metadataOnly += 1;
                break;
        }
        return acc;
    }, {
        textReady: 0,
        pdfReady: 0,
        metadataOnly: 0
    });
}
async function buildReadableMatches(items, registry, queryTokens) {
    const candidates = items.filter(canAttemptTextExtraction).slice(0, MAX_READABLE_CANDIDATES);
    const matches = await Promise.all(candidates.map(async (item) => {
        // Local-first path for NSUD: served from the FTS5 store with zero upstream calls.
        if (item.provider === "nsud") {
            const local = await readNsudDecisionText(item.providerId);
            if (local) {
                const textPreview = local.text.slice(0, PREVIEW_WINDOW_CHARS).trim();
                const snippet = buildSnippet(local.text, queryTokens);
                const continueFromOffset = local.text.length > PREVIEW_WINDOW_CHARS ? PREVIEW_WINDOW_CHARS : null;
                const match = {
                    provider: item.provider,
                    providerId: item.providerId,
                    spisovaZnacka: item.spisovaZnacka,
                    courtName: item.courtName,
                    dateIssued: item.dateIssued,
                    sourceMode: local.sourceMode,
                    textPreview,
                    servedFromLocal: true,
                    continueFromOffset
                };
                if (snippet)
                    match.snippet = snippet;
                return match;
            }
        }
        const provider = registry.get(item.provider);
        if (!provider?.getDecisionText) {
            return null;
        }
        try {
            const textWindow = await provider.getDecisionText({
                provider: item.provider,
                id: item.providerId,
                offsetChars: 0,
                maxChars: PREVIEW_WINDOW_CHARS
            });
            const textPreview = textWindow.text.trim();
            if (!textPreview) {
                return null;
            }
            const snippet = buildSnippet(textWindow.text, queryTokens);
            const match = {
                provider: item.provider,
                providerId: item.providerId,
                spisovaZnacka: item.spisovaZnacka,
                courtName: item.courtName,
                dateIssued: item.dateIssued,
                sourceMode: textWindow.sourceMode,
                textPreview,
                servedFromLocal: false,
                continueFromOffset: textWindow.nextOffset
            };
            if (snippet)
                match.snippet = snippet;
            return match;
        }
        catch {
            return null;
        }
    }));
    return matches.filter((item) => item !== null);
}
function buildBlockedMatches(items) {
    return items
        .filter((item) => !canAttemptTextExtraction(item))
        .slice(0, MAX_BLOCKED_CANDIDATES)
        .map((item) => ({
        provider: item.provider,
        providerId: item.providerId,
        spisovaZnacka: item.spisovaZnacka,
        courtName: item.courtName,
        dateIssued: item.dateIssued,
        reason: item.sourceProvenance.fallbackReason ??
            "The public provider returned metadata only, without document or text extraction path."
    }));
}
function extractQueryTokens(query) {
    if (!query)
        return [];
    return query
        .trim()
        .split(/\s+/)
        .map((token) => token.replaceAll(/["()*]/g, "").trim())
        .filter((token) => token.length > 1);
}
/**
 * Pull a ~240-char excerpt around the first token match in `text`, with each
 * occurrence wrapped in [[ ]].
 *
 * Matches are diacritics- and case-insensitive. For each query token we also
 * try progressively shorter prefixes (down to 4 chars) so Slovak inflections
 * like "škoda"/"škody"/"škodu" all match a user query of "skoda".
 *
 * Returns null when no query tokens are provided or no match is found.
 */
function buildSnippet(text, queryTokens) {
    if (queryTokens.length === 0 || text.length === 0)
        return null;
    const { normalized, originalIndex } = buildNormalizedIndex(text);
    if (normalized.length === 0)
        return null;
    const matchPositions = [];
    let firstMatchInNormalized = Number.POSITIVE_INFINITY;
    for (const token of queryTokens) {
        const fullNeedle = stripDiacriticsLower(token);
        if (fullNeedle.length === 0)
            continue;
        // Find with the full needle first; if nothing matches, try progressively
        // shorter prefixes down to 4 chars to mirror FTS5 prefix-match policy.
        for (let len = fullNeedle.length; len >= Math.min(4, fullNeedle.length); len -= 1) {
            const needle = fullNeedle.slice(0, len);
            const beforeCount = matchPositions.length;
            let cursor = 0;
            while (true) {
                const idx = normalized.indexOf(needle, cursor);
                if (idx === -1)
                    break;
                const start = originalIndex[idx];
                const lastNormalizedIdx = idx + needle.length - 1;
                // Extend the match to the end of the current word in the original
                // text so the highlight shows the inflected form, not just the stem.
                let endOriginal = originalIndex[lastNormalizedIdx] + 1;
                while (endOriginal < text.length && /[\p{L}\p{N}]/u.test(text[endOriginal])) {
                    endOriginal += 1;
                }
                matchPositions.push({ start, end: endOriginal });
                if (idx < firstMatchInNormalized)
                    firstMatchInNormalized = idx;
                cursor = idx + needle.length;
            }
            if (matchPositions.length > beforeCount)
                break;
        }
    }
    if (matchPositions.length === 0)
        return null;
    const firstMatchOriginal = matchPositions
        .map((range) => range.start)
        .reduce((min, value) => (value < min ? value : min), Number.POSITIVE_INFINITY);
    const half = Math.floor(SNIPPET_CONTEXT_CHARS / 2);
    let start = Math.max(0, firstMatchOriginal - half);
    const end = Math.min(text.length, start + SNIPPET_CONTEXT_CHARS);
    start = Math.max(0, end - SNIPPET_CONTEXT_CHARS);
    const inWindow = matchPositions
        .filter((range) => range.start >= start && range.end <= end)
        .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const range of inWindow) {
        const last = merged[merged.length - 1];
        if (last && range.start <= last.end) {
            last.end = Math.max(last.end, range.end);
        }
        else {
            merged.push({ ...range });
        }
    }
    let out = "";
    let cursor = start;
    for (const range of merged) {
        out += text.slice(cursor, range.start);
        out += "[[";
        out += text.slice(range.start, range.end);
        out += "]]";
        cursor = range.end;
    }
    out += text.slice(cursor, end);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < text.length ? "…" : "";
    return `${prefix}${out}${suffix}`;
}
/**
 * Build a lowercased + diacritics-stripped version of `text` together with a
 * parallel array mapping every position in the normalized output back to its
 * source position in `text`. Necessary because NFD-decomposition + diacritic
 * stripping can change string length, so naive indexOf-then-slice would mis-
 * align with the original.
 */
function buildNormalizedIndex(text) {
    const normalizedChars = [];
    const originalIndex = [];
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        const decomposed = ch.normalize("NFD").replaceAll(/\p{Diacritic}/gu, "").toLowerCase();
        for (const out of decomposed) {
            normalizedChars.push(out);
            originalIndex.push(i);
        }
    }
    return { normalized: normalizedChars.join(""), originalIndex };
}
function stripDiacriticsLower(value) {
    return value.normalize("NFD").replaceAll(/\p{Diacritic}/gu, "").toLowerCase();
}
//# sourceMappingURL=enrichment.js.map