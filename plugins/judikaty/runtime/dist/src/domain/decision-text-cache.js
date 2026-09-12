import { buildTextWindow, sliceTextWindow } from "../infra/pdf.js";
import { readNsudDecisionText, readProviderText, upsertProviderText } from "../providers/nsud/law-index-store.js";
/**
 * Providers whose canonical text store IS `provider_texts`. NS is deliberately
 * absent: its text lives in the `decisions` table with its own FTS index, so a
 * second copy here would make every NS document match twice in
 * `search_decision_text`.
 */
const CACHEABLE_PROVIDERS = new Set(["justice", "ustavny"]);
/** Large enough for any judgment in the corpus; the cap only bounds memory. */
const FULL_FETCH_CHARS = 2_000_000;
/**
 * Read-through cache for decision text.
 *
 * The provider clients download a PDF and run `pdftotext` over the whole file
 * before slicing out the requested window, so asking for one window costs
 * exactly as much as asking for the entire document. Until the cached PDFs were
 * pruned this was hidden by `downloadPdfToCache`'s on-disk hit; now that the
 * justice client deletes each PDF after extraction, every window of a long
 * decision — `exportWholeDecisionMarkdown` walks up to 25 of them — was a fresh
 * download. So fetch the document once, store the whole text, and serve every
 * window after that from SQLite.
 */
export async function readDecisionTextWindow(input) {
    if (input.provider === "nsud") {
        // NS keeps its text in the `decisions` table, verbatim as the court published
        // it, and both writers store exactly what `resolveDecisionText` returns — so
        // running it back through `buildTextWindow` reproduces a live read byte for
        // byte, PDF-artefact normalization included. Read-only: the table is filled by
        // the indexer and its (drained) backfill, not by serving a request.
        const stored = await readNsudDecisionText(input.id);
        if (stored) {
            return buildTextWindow({
                provider: "nsud",
                id: input.id,
                text: stored.text,
                offsetChars: input.offsetChars,
                maxChars: input.maxChars,
                sourceMode: stored.sourceMode
            });
        }
    }
    if (!CACHEABLE_PROVIDERS.has(input.provider)) {
        return input.fetchWindow({
            provider: input.provider,
            id: input.id,
            offsetChars: input.offsetChars,
            maxChars: input.maxChars
        });
    }
    const stored = await readProviderText(input.provider, input.id);
    if (stored?.complete) {
        return sliceTextWindow({
            provider: input.provider,
            id: input.id,
            text: stored.text,
            offsetChars: input.offsetChars,
            maxChars: input.maxChars,
            sourceMode: stored.sourceMode
        });
    }
    const whole = await input.fetchWindow({
        provider: input.provider,
        id: input.id,
        offsetChars: 0,
        maxChars: input.fullFetchChars ?? FULL_FETCH_CHARS
    });
    if (whole.windowComplete && whole.text.trim().length > 0) {
        await upsertProviderText({
            provider: input.provider,
            id: input.id,
            text: whole.text,
            sourceMode: whole.sourceMode,
            complete: true
        });
    }
    return sliceTextWindow({
        provider: input.provider,
        id: input.id,
        text: whole.text,
        offsetChars: input.offsetChars,
        maxChars: input.maxChars,
        sourceMode: whole.sourceMode
    });
}
//# sourceMappingURL=decision-text-cache.js.map