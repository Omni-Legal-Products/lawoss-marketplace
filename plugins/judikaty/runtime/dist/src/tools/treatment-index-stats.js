import { countRefLookups, listToolCallCounts, countDecisionRelations, countDecisionRelationsBySource, countNsudDecisionTexts, countNsudLawIndexRecords, countRelationScanLog, countRelationsByDisposition, getLatestStatsSnapshot, listJobRuns, loadCrawlState, loadNsudLawIndexState, recordStatsSnapshot } from "../providers/nsud/law-index-store.js";
import { collectCacheDiskUsage } from "../infra/disk-usage.js";
import { asToolResult } from "../server/response.js";
async function gatherCurrent() {
    const [corpus, metadataRecords, total, nsud, ustavny, justice, scUstavny, scJustice, stUstavny, stJustice, nsState, byDisposition, jobRuns, disk] = await Promise.all([
        countNsudDecisionTexts(),
        countNsudLawIndexRecords(),
        countDecisionRelations(),
        countDecisionRelationsBySource("nsud"),
        countDecisionRelationsBySource("ustavny"),
        countDecisionRelationsBySource("justice"),
        countRelationScanLog("ustavny"),
        countRelationScanLog("justice"),
        loadCrawlState("ustavny"),
        loadCrawlState("justice"),
        loadNsudLawIndexState(),
        countRelationsByDisposition(),
        listJobRuns(),
        collectCacheDiskUsage()
    ]);
    const cursor = (state) => state && typeof state.nextOffset === "number" ? state.nextOffset : null;
    const coveragePct = metadataRecords > 0 ? Math.round((corpus / metadataRecords) * 1000) / 10 : 0;
    return {
        nsText: {
            corpus,
            metadataRecords,
            coveragePct,
            lastIndexerRunAt: nsState.lastRunAt ?? null,
            highestKnownDecisionId: nsState.highestKnownDecisionId ?? null,
            discoveredHeadDecisionId: nsState.discoveredHeadDecisionId ?? null
        },
        relations: { total, nsud, ustavny, justice, byDisposition },
        scanned: { ustavny: scUstavny, justice: scJustice },
        refLookupsTracked: await countRefLookups(),
        toolCalls: await listToolCallCounts(),
        crawlCursors: { ustavny: cursor(stUstavny), justice: cursor(stJustice) },
        disk,
        jobRuns,
        generatedAt: new Date().toISOString()
    };
}
export async function collectTreatmentIndexStats(input) {
    const current = await gatherCurrent();
    const prevRow = await getLatestStatsSnapshot();
    const previous = prevRow?.payload ?? null;
    if (input.recordSnapshot) {
        await recordStatsSnapshot(current);
    }
    return { current, previous, previousTakenAt: prevRow?.takenAt ?? null };
}
export function registerGetTreatmentIndexStatsTool(server) {
    server.registerTool("get_treatment_index_stats", {
        title: "Treatment Index Stats",
        description: "Prehľad stavu indexu osudu rozhodnutí: veľkosť NS textového korpusu, počty vzťahov podľa súdu (NS/ÚS/justice), pokrytie crawlerov a posledný beh. Read-only; nezapisuje snapshot.",
        inputSchema: {}
    }, async () => asToolResult(await collectTreatmentIndexStats({ recordSnapshot: false })));
}
//# sourceMappingURL=treatment-index-stats.js.map