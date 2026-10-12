import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getJudiciaryDataDir } from "../../infra/data-dir.js";
import { asCaseRef, isSelfRelation, normalizeCaseRef } from "../../domain/relation-extractor.js";
import { classifyModelLabel, modelLabelApplies } from "../../domain/relation-model-labels.js";
import { IndexSchemaTooNewError, SCHEMA_VERSION, applySchemaVersion, initSchema, readSchemaVersion } from "./schema.js";
import { normalizeForFts } from "../../domain/text-normalization.js";
import { buildNsudFtsSql, mapNsudFtsRows, mapProviderFtsRows, normalizeFtsParams, planProviderFtsQuery, sanitizeFtsQuery } from "./fts-queries.js";
import { QueryWorkerUnavailableError, isQueryWorkerEnabled, runReadQueryOnWorker } from "./query-worker-client.js";
import { existingRelationCovers } from "../../domain/justice-relation-orientation.js";
const STATE_ROW_ID = 1;
let cachedHandle = null;
let cachedRoot = null;
function getIndexRoot() {
    return path.join(getJudiciaryDataDir(), "nsud", "law-index");
}
function getDatabasePath() {
    return path.join(getIndexRoot(), "index.sqlite");
}
/** Resolved lazily so the query worker picks up the cwd in force when it spawns. */
export function getIndexDatabasePath() {
    return getDatabasePath();
}
/**
 * Opens the index and brings its schema up to date. The stored version is checked
 * first: a too-new index (from a newer build, or a snapshot imported by one) must be
 * refused before anything writes to it — switching it to WAL rewrites its header and
 * initSchema adds tables, either of which would alter a file this build cannot read
 * correctly. A failed open closes its connection instead of leaking it.
 */
function openIndexDatabase(file) {
    const db = new DatabaseSync(file);
    try {
        // Concurrent nightly indexers (NS text / NS relations / ÚS / justice) can write
        // the same DB at once; wait for the lock instead of throwing SQLITE_BUSY. A
        // connection setting, so it is safe before the version check.
        db.exec("PRAGMA busy_timeout = 30000;");
        const stored = readSchemaVersion(db);
        if (stored > SCHEMA_VERSION)
            throw new IndexSchemaTooNewError(stored, SCHEMA_VERSION);
        db.exec("PRAGMA journal_mode = WAL;");
        db.exec("PRAGMA foreign_keys = ON;");
        db.exec("PRAGMA synchronous = NORMAL;");
        initSchema(db);
        applySchemaVersion(db);
        return db;
    }
    catch (error) {
        db.close();
        throw error;
    }
}
async function getHandle() {
    const root = getIndexRoot();
    if (cachedHandle && cachedRoot === root) {
        return cachedHandle;
    }
    // The working directory can change between calls in tests, so drop a stale
    // handle whenever the resolved root moves underneath us.
    if (cachedHandle) {
        cachedHandle.db.close();
        cachedHandle = null;
        cachedRoot = null;
    }
    await mkdir(root, { recursive: true });
    const db = openIndexDatabase(getDatabasePath());
    const handle = {
        db,
        insertRecord: db.prepare(`INSERT INTO records (id, ecli, spisova_znacka, date_issued, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         ecli = excluded.ecli,
         spisova_znacka = excluded.spisova_znacka,
         date_issued = excluded.date_issued,
         updated_at = excluded.updated_at`),
        deleteRecordTokens: db.prepare("DELETE FROM record_tokens WHERE record_id = ?"),
        insertToken: db.prepare("INSERT OR IGNORE INTO record_tokens (record_id, token) VALUES (?, ?)"),
        selectRecord: db.prepare(`SELECT r.id, r.ecli, r.spisova_znacka, r.date_issued, r.updated_at,
              COALESCE(group_concat(t.token, char(31)), '') AS tokens
       FROM records r
       LEFT JOIN record_tokens t ON t.record_id = r.id
       WHERE r.id = ?
       GROUP BY r.id`),
        countByToken: db.prepare("SELECT COUNT(*) AS count FROM record_tokens WHERE token = ?"),
        searchByToken: db.prepare("SELECT record_id FROM record_tokens WHERE token = ? ORDER BY record_id LIMIT ? OFFSET ?"),
        listRecords: db.prepare(`SELECT r.id, r.ecli, r.spisova_znacka, r.date_issued, r.updated_at,
              COALESCE(group_concat(t.token, char(31)), '') AS tokens
       FROM records r
       LEFT JOIN record_tokens t ON t.record_id = r.id
       GROUP BY r.id`),
        upsertState: db.prepare(`INSERT INTO state (id, payload) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`),
        selectState: db.prepare("SELECT payload FROM state WHERE id = ?"),
        upsertDecisionText: db.prepare(`INSERT INTO decisions (id, text, text_sha256, source_mode, indexed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         text = excluded.text,
         text_sha256 = excluded.text_sha256,
         source_mode = excluded.source_mode,
         indexed_at = excluded.indexed_at`),
        selectDecisionText: db.prepare("SELECT text, text_sha256, source_mode, indexed_at FROM decisions WHERE id = ?"),
        selectDecisionRowid: db.prepare("SELECT rowid FROM decisions WHERE id = ?"),
        deleteDecisionFts: db.prepare("DELETE FROM decisions_fts WHERE rowid = ?"),
        insertDecisionFts: db.prepare("INSERT INTO decisions_fts(rowid, text) VALUES (?, ?)"),
        /**
         * Bookkeeping for the FTS normalization backfill. Written by the text write
         * paths themselves — see `upsertNsudDecisionText` — so the nightly
         * `index:fts-normalize` job stops re-doing work the write already did.
         */
        upsertFtsNormalized: db.prepare(`INSERT INTO fts_normalized (provider, id, text_sha256, normalized_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider, id) DO UPDATE SET
         text_sha256 = excluded.text_sha256,
         normalized_at = excluded.normalized_at`),
        countDecisionText: db.prepare("SELECT COUNT(*) AS count FROM decisions"),
        selectRecordIdsWithoutText: db.prepare(`SELECT r.id FROM records r
       LEFT JOIN decisions d ON d.id = r.id
       WHERE d.id IS NULL
       ORDER BY (r.text_attempted_at IS NULL) DESC,
                r.text_attempted_at ASC,
                CAST(r.id AS INTEGER) DESC
       LIMIT ?`),
        insertRelation: db.prepare(`INSERT INTO decision_relations
         (source_provider, source_id, source_ref, source_ref_norm, source_court,
          target_court, target_ref, target_ref_norm, relation, disposition,
          target_date, confidence, extracted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_provider, source_id, target_ref_norm) DO UPDATE SET
         source_ref = excluded.source_ref,
         source_ref_norm = excluded.source_ref_norm,
         source_court = excluded.source_court,
         target_court = excluded.target_court,
         target_ref = excluded.target_ref,
         relation = excluded.relation,
         disposition = excluded.disposition,
         target_date = excluded.target_date,
         confidence = excluded.confidence,
         extracted_at = excluded.extracted_at`),
        selectRelationsByTargetNorm: db.prepare(`SELECT source_provider, source_id, source_ref, source_court,
              target_court, target_ref, target_ref_norm, relation, disposition,
              target_date, confidence
       FROM decision_relations WHERE target_ref_norm = ?
       ORDER BY confidence DESC`),
        selectRelationsBySourceRefNorm: db.prepare(`SELECT source_provider, source_id, source_ref, source_court,
              target_court, target_ref, target_ref_norm, relation, disposition,
              target_date, confidence
       FROM decision_relations WHERE source_ref_norm = ?
       ORDER BY confidence DESC`),
        selectRelationsBySource: db.prepare(`SELECT source_provider, source_id, source_ref, source_court,
              target_court, target_ref, target_ref_norm, relation, disposition,
              target_date, confidence
       FROM decision_relations WHERE source_provider = ? AND source_id = ?
       ORDER BY confidence DESC`),
        countRelations: db.prepare("SELECT COUNT(*) AS count FROM decision_relations"),
        selectIdsMissingRelations: db.prepare(`SELECT id FROM decisions
       WHERE relation_extracted_at IS NULL
       ORDER BY CAST(id AS INTEGER) DESC
       LIMIT ?`),
        markRelationsExtracted: db.prepare("UPDATE decisions SET relation_extracted_at = ? WHERE id = ?"),
        countRelationsBySource: db.prepare("SELECT COUNT(*) AS count FROM decision_relations WHERE source_provider = ?"),
        selectIneJusticeSources: db.prepare(`SELECT DISTINCT dr.source_id AS source_id, dr.source_ref AS source_ref
       FROM decision_relations dr
       LEFT JOIN relation_scan_log sl
         ON sl.provider = 'justice-text' AND sl.source_id = dr.source_id
       WHERE dr.source_provider = 'justice' AND dr.disposition = 'ine' AND sl.source_id IS NULL
       LIMIT ?`),
        updateIneDisposition: db.prepare(`UPDATE decision_relations
       SET disposition = ?, confidence = ?, disposition_updated_at = ?
       WHERE source_provider = 'justice' AND source_id = ? AND target_ref_norm = ? AND disposition = 'ine'`),
        markTextAttempted: db.prepare("UPDATE records SET text_attempted_at = ? WHERE id = ?"),
        insertScanLog: db.prepare(`INSERT INTO relation_scan_log (provider, source_id, scanned_at)
       VALUES (?, ?, ?)
       ON CONFLICT(provider, source_id) DO UPDATE SET scanned_at = excluded.scanned_at`),
        selectScanLogHits: db.prepare("SELECT source_id FROM relation_scan_log WHERE provider = ? AND source_id = ?"),
        countScanLog: db.prepare("SELECT COUNT(*) AS count FROM relation_scan_log WHERE provider = ?"),
        upsertCrawlState: db.prepare(`INSERT INTO crawl_state (provider, payload) VALUES (?, ?)
       ON CONFLICT(provider) DO UPDATE SET payload = excluded.payload`),
        selectCrawlState: db.prepare("SELECT payload FROM crawl_state WHERE provider = ?"),
        insertStatsSnapshot: db.prepare("INSERT INTO stats_snapshots (taken_at, payload) VALUES (?, ?)"),
        selectLatestStatsSnapshot: db.prepare("SELECT taken_at, payload FROM stats_snapshots ORDER BY id DESC LIMIT 1"),
        upsertJobRun: db.prepare(`INSERT INTO job_runs (job, last_run_at, payload) VALUES (?, ?, ?)
       ON CONFLICT(job) DO UPDATE SET last_run_at = excluded.last_run_at, payload = excluded.payload`),
        selectJobRuns: db.prepare("SELECT job, last_run_at, payload FROM job_runs ORDER BY last_run_at DESC"),
        selectRelationDispositionCounts: db.prepare("SELECT disposition, COUNT(*) AS count FROM decision_relations GROUP BY disposition"),
        upsertWatchlist: db.prepare(`INSERT INTO watchlist (ref_norm, ref_raw, note, added_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(ref_norm) DO UPDATE SET
         ref_raw = excluded.ref_raw,
         note = COALESCE(excluded.note, watchlist.note)`),
        deleteWatchlist: db.prepare("DELETE FROM watchlist WHERE ref_norm = ?"),
        selectWatchlist: db.prepare("SELECT ref_norm, ref_raw, note, added_at FROM watchlist ORDER BY added_at DESC"),
        selectRelationsSince: db.prepare(`SELECT source_provider, source_id, source_ref, source_court,
              target_court, target_ref, target_ref_norm, relation, disposition,
              target_date, confidence, disposition_updated_at
       FROM decision_relations WHERE extracted_at > ? OR disposition_updated_at > ?
       ORDER BY COALESCE(disposition_updated_at, extracted_at) DESC LIMIT ?`),
        upsertProviderText: db.prepare(`INSERT INTO provider_texts (provider, id, text, text_sha256, source_mode, indexed_at, text_complete)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, id) DO UPDATE SET
         text = excluded.text,
         text_sha256 = excluded.text_sha256,
         source_mode = excluded.source_mode,
         indexed_at = excluded.indexed_at,
         text_complete = excluded.text_complete`),
        selectProviderText: db.prepare("SELECT text, text_sha256, source_mode, indexed_at, text_complete FROM provider_texts WHERE provider = ? AND id = ?"),
        selectProviderTextRowid: db.prepare("SELECT rowid FROM provider_texts WHERE provider = ? AND id = ?"),
        deleteProviderTextFts: db.prepare("DELETE FROM provider_texts_fts WHERE rowid = ?"),
        insertProviderTextFts: db.prepare("INSERT INTO provider_texts_fts(rowid, text) VALUES (?, ?)"),
        countProviderTextsAll: db.prepare("SELECT COUNT(*) AS count FROM provider_texts"),
        countProviderTextsByProvider: db.prepare("SELECT COUNT(*) AS count FROM provider_texts WHERE provider = ?"),
        upsertProviderRecord: db.prepare(`INSERT INTO provider_records (provider, id, spisova_znacka, spisova_znacka_norm, court_name, date_issued, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, id) DO UPDATE SET
         spisova_znacka = excluded.spisova_znacka,
         spisova_znacka_norm = excluded.spisova_znacka_norm,
         court_name = excluded.court_name,
         date_issued = excluded.date_issued,
         updated_at = excluded.updated_at`),
        selectProviderRecordsByRefNorm: db.prepare(`SELECT provider, id, spisova_znacka, court_name, date_issued
       FROM provider_records WHERE spisova_znacka_norm = ?`),
        selectProviderRecordByPk: db.prepare(`SELECT provider, id, spisova_znacka, court_name, date_issued
       FROM provider_records WHERE provider = ? AND id = ?`),
        countProviderRecordsAll: db.prepare("SELECT COUNT(*) AS count FROM provider_records"),
        countProviderRecordsByProvider: db.prepare("SELECT COUNT(*) AS count FROM provider_records WHERE provider = ?"),
        selectScanLogIdsMissingProviderText: db.prepare(`SELECT sl.source_id AS source_id
       FROM relation_scan_log sl
       LEFT JOIN provider_texts pt ON pt.provider = ? AND pt.id = sl.source_id
       WHERE sl.provider = ?
         AND pt.id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM relation_scan_log empty_sl
           WHERE empty_sl.provider = ? AND empty_sl.source_id = sl.source_id
         )
       LIMIT ?`),
        // A primary-key prefix seek per relation; never a scan. Newest label first.
        selectNewestModelLabel: db.prepare(`SELECT role, role_confidence, outcome, outcome_confidence
       FROM relation_model_labels
       WHERE source_provider = ? AND source_id = ? AND target_ref_norm = ?
       ORDER BY labelled_at DESC, label_run DESC
       LIMIT 1`),
        upsertModelLabel: db.prepare(`INSERT INTO relation_model_labels
         (source_provider, source_id, target_ref_norm, label_run, model, role,
          role_confidence, outcome, outcome_confidence, question_versions, labelled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_provider, source_id, target_ref_norm, label_run) DO UPDATE SET
         model = excluded.model,
         role = excluded.role,
         role_confidence = excluded.role_confidence,
         outcome = excluded.outcome,
         outcome_confidence = excluded.outcome_confidence,
         question_versions = excluded.question_versions,
         labelled_at = excluded.labelled_at`),
        deleteModelLabelRunBatch: db.prepare(`DELETE FROM relation_model_labels WHERE rowid IN (
         SELECT rowid FROM relation_model_labels WHERE label_run = ? LIMIT ?
       )`),
        selectRelationByNaturalKey: db.prepare(`SELECT disposition FROM decision_relations
       WHERE source_provider = ? AND source_id = ? AND target_ref_norm = ?`)
    };
    cachedHandle = handle;
    cachedRoot = root;
    await migrateLegacyJsonIfNeeded(root, handle);
    return handle;
}
async function migrateLegacyJsonIfNeeded(root, handle) {
    const countRow = handle.db
        .prepare("SELECT COUNT(*) AS count FROM records")
        .get();
    if ((countRow?.count ?? 0) > 0) {
        return;
    }
    const recordsDir = path.join(root, "records");
    const legacyMarker = path.join(root, ".legacy-json-migrated");
    if (await pathExists(legacyMarker)) {
        return;
    }
    if (!(await pathExists(recordsDir))) {
        return;
    }
    let entries;
    try {
        entries = await readdir(recordsDir);
    }
    catch {
        return;
    }
    const recordFiles = entries.filter((entry) => entry.endsWith(".json"));
    if (recordFiles.length === 0) {
        await ensureMarker(legacyMarker);
        return;
    }
    console.log(`[nsud-law-index-store] migrating ${recordFiles.length} legacy JSON records into SQLite`);
    const batchSize = 500;
    for (let offset = 0; offset < recordFiles.length; offset += batchSize) {
        const batch = recordFiles.slice(offset, offset + batchSize);
        const records = [];
        for (const fileName of batch) {
            try {
                const raw = await readFile(path.join(recordsDir, fileName), "utf-8");
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.id === "string") {
                    records.push(parsed);
                }
            }
            catch {
                // Skip unreadable legacy files; they will simply not be migrated.
            }
        }
        if (records.length > 0) {
            runInTransaction(handle.db, () => {
                for (const record of records) {
                    writeRecord(handle, record);
                }
            });
        }
    }
    const legacyStatePath = path.join(root, "state.json");
    if (await pathExists(legacyStatePath)) {
        try {
            const raw = await readFile(legacyStatePath, "utf-8");
            const parsed = JSON.parse(raw);
            handle.upsertState.run(STATE_ROW_ID, JSON.stringify(parsed));
        }
        catch {
            // ignore malformed legacy state
        }
    }
    await ensureMarker(legacyMarker);
    await archiveLegacyTrees(root);
}
async function archiveLegacyTrees(root) {
    const archiveAt = new Date().toISOString().replaceAll(":", "-");
    for (const subdir of ["records", "tokens"]) {
        const source = path.join(root, subdir);
        if (!(await pathExists(source)))
            continue;
        const dest = path.join(root, `${subdir}.legacy-${archiveAt}`);
        try {
            await rename(source, dest);
        }
        catch {
            // If renaming fails (e.g., target exists), leave the legacy tree as-is.
        }
    }
}
async function ensureMarker(markerPath) {
    await mkdir(path.dirname(markerPath), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(markerPath, new Date().toISOString(), "utf-8");
}
async function pathExists(target) {
    try {
        await stat(target);
        return true;
    }
    catch {
        return false;
    }
}
function runInTransaction(db, body) {
    db.exec("BEGIN");
    try {
        body();
        db.exec("COMMIT");
    }
    catch (error) {
        try {
            db.exec("ROLLBACK");
        }
        catch {
            // best-effort rollback; surface the original failure
        }
        throw error;
    }
}
function writeRecord(handle, record) {
    handle.insertRecord.run(record.id, record.ecli, record.spisovaZnacka, record.dateIssued, record.updatedAt);
    handle.deleteRecordTokens.run(record.id);
    for (const token of record.searchTokens) {
        handle.insertToken.run(record.id, token);
    }
}
function rowToRecord(row) {
    return {
        id: row.id,
        ecli: row.ecli,
        spisovaZnacka: row.spisova_znacka,
        dateIssued: row.date_issued,
        updatedAt: row.updated_at,
        searchTokens: row.tokens.length > 0 ? row.tokens.split("") : []
    };
}
export async function upsertNsudLawIndexRecord(record) {
    const handle = await getHandle();
    runInTransaction(handle.db, () => writeRecord(handle, record));
}
export async function readNsudLawIndexRecord(id) {
    const handle = await getHandle();
    const row = handle.selectRecord.get(id);
    return row ? rowToRecord(row) : null;
}
export async function searchNsudLawIndexByToken(input) {
    const handle = await getHandle();
    const rows = handle.searchByToken.all(input.searchToken, input.limit, input.offset);
    return rows.map((row) => row.record_id);
}
export async function countNsudLawIndexByToken(searchToken) {
    const handle = await getHandle();
    const row = handle.countByToken.get(searchToken);
    return row?.count ?? 0;
}
/**
 * Kept for API compatibility with the legacy JSON store. The SQLite store
 * already maintains the record_tokens table on every upsert, so this is a
 * no-op for in-place writes; it remains useful as a one-shot reconciler if a
 * caller wants to fully rewrite the index from a known set of records.
 */
export async function rebuildNsudLawIndexTokens(records) {
    if (records.length === 0)
        return;
    const handle = await getHandle();
    runInTransaction(handle.db, () => {
        for (const record of records) {
            writeRecord(handle, record);
        }
    });
}
export async function listNsudLawIndexRecords() {
    const handle = await getHandle();
    const rows = handle.listRecords.all();
    return rows.map(rowToRecord);
}
export async function countNsudLawIndexRecords() {
    const handle = await getHandle();
    const row = handle.db
        .prepare("SELECT COUNT(*) AS count FROM records")
        .get();
    return row?.count ?? 0;
}
/**
 * `records.date_issued` has no CHECK constraint, so nothing prevents an
 * empty string or a non-bare-ISO value (e.g. a full timestamp) from being
 * stored. Both would corrupt a string-range comparison silently:
 *  - `'' <= dateTo` is TRUE for any non-empty `dateTo` (empty string sorts
 *    before everything), so a `dateTo`-only query would wrongly include it.
 *  - `"2015-06-15T10:00:00"` sorts *after* `"2015-06-15"`, so it would be
 *    wrongly excluded from a same-day `dateTo` and wrongly included (with a
 *    malformed `dateIssued` in the response) in a broader range.
 * `NULL` needs no such guard: SQL comparisons against NULL are never TRUE,
 * so `date_issued >= ?`/`date_issued <= ?` already exclude it on their own.
 * This fragment is applied to every WHERE clause in this file that filters
 * on `date_issued`, so a malformed value is always treated the same way the
 * live path treats a missing/unparsable `dateIssued`: dropped, never kept
 * as if verified.
 */
const VALID_DATE_ISSUED_SQL = "date_issued IS NOT NULL AND length(date_issued) = 10 AND date_issued GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'";
/**
 * Date-range metadata search over the local `records` mirror, for
 * `search_decisions(provider="nsud", dateFrom/dateTo)` when no free-text-ish
 * criterion is present. Exists because the NS SR portal ignores
 * `art_datum_od`/`art_datum_do` and always returns the same first page, so
 * this is the only path that can honor a date range for nsud at all.
 *
 * `dateFrom`/`dateTo` are compared as plain strings against the stored
 * `date_issued` TEXT column: both are anchored ISO `YYYY-MM-DD`, and
 * fixed-width ISO dates sort lexicographically the same as chronologically,
 * so no date parsing is needed here. `total` is a real `COUNT(*)` over the
 * same predicate as the page query -- not a cap, not the page length -- so
 * both queries below must stay in sync on their WHERE clause.
 *
 * Ordering ties on `id` are broken numerically (`CAST(id AS INTEGER)`), not
 * lexicographically, matching this file's existing convention for NS's
 * numeric-string ids (see `selectRecordIdsWithoutText`) -- a plain text sort
 * of "id DESC" would put "99" ahead of "100".
 */
export async function searchNsudRecordsByDateRange(input) {
    const handle = await getHandle();
    const conditions = [VALID_DATE_ISSUED_SQL];
    const params = [];
    if (input.dateFrom) {
        conditions.push("date_issued >= ?");
        params.push(input.dateFrom);
    }
    if (input.dateTo) {
        conditions.push("date_issued <= ?");
        params.push(input.dateTo);
    }
    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const countRow = handle.db
        .prepare(`SELECT COUNT(*) AS count FROM records ${whereClause}`)
        .get(...params);
    const rows = handle.db
        .prepare(`SELECT id, ecli, spisova_znacka, date_issued, updated_at
       FROM records
       ${whereClause}
       ORDER BY date_issued DESC, CAST(id AS INTEGER) DESC
       LIMIT ? OFFSET ?`)
        .all(...params, input.limit, input.offset);
    return {
        total: countRow?.count ?? 0,
        rows: rows.map((row) => ({
            id: row.id,
            ecli: row.ecli,
            spisovaZnacka: row.spisova_znacka,
            dateIssued: row.date_issued,
            updatedAt: row.updated_at
        }))
    };
}
/**
 * State-independent freshness signal for `search_decisions(provider="nsud",
 * dateFrom/dateTo)`'s local-index route: what is the newest decision date
 * actually present in the index, read directly from the data rather than
 * from the indexer's self-reported cursor (`highestKnownDecisionId` et al).
 *
 * This is deliberately NOT derived from indexer state/id arithmetic: the
 * indexer's own head-detection has been wrong before (see
 * docs/NSUD_INDEXING.md) while still reporting a plausible-looking cursor,
 * and NS decision ids are not a reliable proxy for "most recent backfilled
 * date" either -- the backfill descends from the head towards id 1, so a
 * large id/cursor gap reflects how much of the *older* corpus has already
 * been walked, not a shortfall at the recent end. Reading the actual
 * `MAX(date_issued)` self-heals as new decisions are indexed and needs no
 * knowledge of backfill direction, mode, or a possibly-stale head.
 *
 * Two separate single-purpose queries, not one combined `MAX/SUM(CASE ...)`
 * pass. `EXPLAIN QUERY PLAN` confirms `idx_records_date_issued` IS used as
 * a covering index either way (`SCAN records USING COVERING INDEX
 * idx_records_date_issued`) -- an earlier version of this comment claimed
 * it could not be, which was wrong. What actually costs time is evaluating
 * the `length()`/`GLOB` format check per row; a single combined query does
 * that twice per row (once for MAX's CASE, once for SUM's CASE), roughly
 * doubling the cost. Splitting also lets the max lookup become a genuine
 * index SEEK (`... WHERE <valid> ORDER BY date_issued DESC LIMIT 1`,
 * `SEARCH ... USING COVERING INDEX idx_records_date_issued (date_issued>?)`)
 * instead of riding along with the O(rows) invalid-count SUM. Measured on a
 * synthetic 161k-row table: combined ~62-64ms; split, max ~0.02-0.08ms +
 * invalid count ~31.5-31.8ms (roughly halves the total, with no caching and
 * no staleness surface -- freshness honesty is the point of this function).
 */
export async function getNsudRecordsDateFreshness() {
    const handle = await getHandle();
    const maxRow = handle.db
        .prepare(`SELECT date_issued FROM records WHERE ${VALID_DATE_ISSUED_SQL} ORDER BY date_issued DESC LIMIT 1`)
        .get();
    const invalidRow = handle.db
        .prepare(`SELECT SUM(CASE WHEN date_issued IS NOT NULL AND NOT (${VALID_DATE_ISSUED_SQL}) THEN 1 ELSE 0 END) AS invalid_count
       FROM records`)
        .get();
    return {
        maxDateIssued: maxRow?.date_issued ?? null,
        invalidDateIssuedCount: invalidRow?.invalid_count ?? 0
    };
}
export async function loadNsudLawIndexState() {
    const handle = await getHandle();
    const row = handle.selectState.get(STATE_ROW_ID);
    if (!row) {
        return {
            lastRunAt: null,
            processed: 0,
            offset: 0,
            nextDecisionId: null,
            lastIndexedDecisionId: null,
            highestKnownDecisionId: null,
            discoveredHeadDecisionId: null,
            skipped: 0
        };
    }
    let parsed;
    try {
        parsed = JSON.parse(row.payload);
    }
    catch {
        return {
            lastRunAt: null,
            processed: 0,
            offset: 0,
            nextDecisionId: null,
            lastIndexedDecisionId: null,
            highestKnownDecisionId: null,
            discoveredHeadDecisionId: null,
            skipped: 0
        };
    }
    return {
        lastRunAt: parsed.lastRunAt ?? null,
        processed: parsed.processed ?? 0,
        ...(typeof parsed.offset === "number" ? { offset: parsed.offset } : {}),
        ...(typeof parsed.nextDecisionId === "number" || parsed.nextDecisionId === null
            ? { nextDecisionId: parsed.nextDecisionId }
            : {}),
        ...(typeof parsed.lastIndexedDecisionId === "number" || parsed.lastIndexedDecisionId === null
            ? { lastIndexedDecisionId: parsed.lastIndexedDecisionId }
            : {}),
        ...(typeof parsed.highestKnownDecisionId === "number" || parsed.highestKnownDecisionId === null
            ? { highestKnownDecisionId: parsed.highestKnownDecisionId }
            : {}),
        ...(typeof parsed.discoveredHeadDecisionId === "number" || parsed.discoveredHeadDecisionId === null
            ? { discoveredHeadDecisionId: parsed.discoveredHeadDecisionId }
            : {}),
        ...(typeof parsed.skipped === "number" ? { skipped: parsed.skipped } : {})
    };
}
export async function saveNsudLawIndexState(state) {
    const handle = await getHandle();
    handle.upsertState.run(STATE_ROW_ID, JSON.stringify(state));
}
export async function upsertNsudDecisionText(input) {
    if (!input.text || input.text.trim().length === 0) {
        return;
    }
    const handle = await getHandle();
    const sha256 = (await import("node:crypto")).createHash("sha256").update(input.text).digest("hex");
    const indexedAt = new Date().toISOString();
    runInTransaction(handle.db, () => {
        handle.upsertDecisionText.run(input.id, input.text, sha256, input.sourceMode, indexedAt);
        const rowidRow = handle.selectDecisionRowid.get(input.id);
        if (rowidRow) {
            // FTS5 external content tables don't have UPSERT semantics, so just
            // delete and re-insert by rowid. The rowid is stable because decisions
            // is rowid-mapped by PRIMARY KEY id.
            handle.deleteDecisionFts.run(rowidRow.rowid);
            // Letter-spacing collapsed for the index only: the base table keeps what the
            // court published, because citations must reproduce that verbatim.
            handle.insertDecisionFts.run(rowidRow.rowid, normalizeForFts(input.text));
            // Record that in the SAME transaction as the write above. The nightly
            // backfill selects rows whose sha does not match this table, so without
            // this every text written here queued for a re-normalization that would
            // produce byte-identical FTS content -- ~3,200 redundant rewrites a night,
            // an hour of work to reach a state the write already reached. Claiming it
            // outside the transaction would be worse than not claiming it: a crash
            // between the two would leave a row asserting a normalization that never
            // happened, and nothing would ever revisit it.
            handle.upsertFtsNormalized.run("nsud", input.id, sha256, indexedAt);
        }
    });
}
export async function readNsudDecisionText(id) {
    const handle = await getHandle();
    const row = handle.selectDecisionText.get(id);
    if (!row)
        return null;
    if (row.source_mode !== "inline" && row.source_mode !== "pdf_extract")
        return null;
    return {
        id,
        text: row.text,
        textSha256: row.text_sha256,
        sourceMode: row.source_mode,
        indexedAt: row.indexed_at
    };
}
export async function countNsudDecisionTexts() {
    const handle = await getHandle();
    const row = handle.countDecisionText.get();
    return row?.count ?? 0;
}
export async function listRecordIdsMissingText(limit) {
    const handle = await getHandle();
    const rows = handle.selectRecordIdsWithoutText.all(Math.max(1, limit));
    return rows.map((row) => row.id);
}
/**
 * Route a full-text search to the query worker when one is enabled.
 *
 * Returns `null` when the caller should run the query in-process: either the
 * worker is off (CLI/cron) or it cannot reach the database yet. A *timeout* is
 * deliberately NOT a fallback — retrying a query that already overran on the
 * main thread is exactly the failure mode the worker exists to prevent, so the
 * error propagates to the caller instead.
 */
async function tryOffloadFts(input) {
    if (!isQueryWorkerEnabled())
        return null;
    try {
        return { rows: await runReadQueryOnWorker(input) };
    }
    catch (error) {
        if (error instanceof QueryWorkerUnavailableError)
            return null;
        throw error;
    }
}
export async function searchNsudDecisionTextFts(input) {
    const query = sanitizeFtsQuery(input.query);
    if (!query)
        return [];
    const { limit, offset, around } = normalizeFtsParams(input);
    const sql = buildNsudFtsSql({ around });
    const params = [query, limit, offset];
    const offloaded = await tryOffloadFts({
        label: "nsudFts",
        sql,
        params
    });
    if (offloaded)
        return mapNsudFtsRows(offloaded.rows);
    const handle = await getHandle();
    const rows = handle.db.prepare(sql).all(...params);
    return mapNsudFtsRows(rows);
}
/**
 * Generic multi-provider counterpart to `upsertNsudDecisionText`, keyed by
 * `(provider, id)` instead of NS's bare `id`. Mirrors the same delete-old-FTS-
 * row + upsert + insert-FTS-row transaction so replacing a document's text
 * never leaves stale FTS rows behind.
 */
export async function upsertProviderText(input) {
    if (!input.text || input.text.trim().length === 0) {
        return;
    }
    const handle = await getHandle();
    const complete = input.complete === true;
    if (!complete) {
        // The justice enricher stores a 20,000-char window. Letting it overwrite a row
        // that already holds the whole judgment would trade a complete text for a
        // truncated one, so a partial write never displaces a complete one.
        const existing = handle.selectProviderText.get(input.provider, input.id);
        if (existing?.text_complete === 1) {
            return;
        }
    }
    const sha256 = createHash("sha256").update(input.text).digest("hex");
    const indexedAt = new Date().toISOString();
    runInTransaction(handle.db, () => {
        handle.upsertProviderText.run(input.provider, input.id, input.text, sha256, input.sourceMode, indexedAt, complete ? 1 : 0);
        const rowidRow = handle.selectProviderTextRowid.get(input.provider, input.id);
        if (rowidRow) {
            // FTS5 external content tables don't have UPSERT semantics, so just
            // delete and re-insert by rowid. The rowid is stable because
            // provider_texts is rowid-mapped by UNIQUE(provider, id).
            handle.deleteProviderTextFts.run(rowidRow.rowid);
            handle.insertProviderTextFts.run(rowidRow.rowid, normalizeForFts(input.text));
            // Same transaction, same reason as upsertNsudDecisionText above. Note the
            // sha recorded is the sha of the STORED text, which is exactly what the
            // backfill's queue compares against -- so when a truncated row is later
            // replaced by the complete judgment the sha changes and the row correctly
            // queues again.
            handle.upsertFtsNormalized.run(input.provider, input.id, sha256, indexedAt);
        }
    });
}
export async function readProviderText(provider, id) {
    const handle = await getHandle();
    const row = handle.selectProviderText.get(provider, id);
    if (!row)
        return null;
    if (row.source_mode !== "inline" && row.source_mode !== "pdf_extract")
        return null;
    return {
        provider,
        id,
        text: row.text,
        textSha256: row.text_sha256,
        sourceMode: row.source_mode,
        indexedAt: row.indexed_at,
        complete: row.text_complete === 1
    };
}
export async function countProviderTexts(provider) {
    const handle = await getHandle();
    if (provider) {
        const row = handle.countProviderTextsByProvider.get(provider);
        return row?.count ?? 0;
    }
    const row = handle.countProviderTextsAll.get();
    return row?.count ?? 0;
}
export async function searchProviderTextsFts(input) {
    const plan = planProviderFtsQuery(input);
    if (!plan)
        return [];
    const offloaded = await tryOffloadFts({
        label: "providerFts",
        sql: plan.sql,
        params: plan.params
    });
    const rows = offloaded
        ? offloaded.rows
        : (await getHandle()).db.prepare(plan.sql).all(...plan.params);
    const hits = mapProviderFtsRows(rows);
    if (!plan.postFilter)
        return hits;
    return hits.filter((hit) => plan.postFilter.has(hit.provider)).slice(0, plan.limit);
}
/**
 * Generic multi-provider metadata mirror keyed by `(provider, id)`. Unlike
 * `upsertProviderText`, this accepts null `spisovaZnacka`/`courtName`/
 * `dateIssued` — the justice list-metadata backfill (Task 3) upserts records
 * for every crawled item, many of which the source API returns with nulls.
 * `spisova_znacka_norm` is computed via `normalizeCaseRef` only when
 * `spisovaZnacka` is non-null; otherwise the norm column stays null so a
 * later re-upsert with a real ref can still populate it.
 */
export async function upsertProviderRecord(input) {
    const handle = await getHandle();
    const spisovaZnackaNorm = input.spisovaZnacka ? normalizeCaseRef(input.spisovaZnacka) : null;
    const updatedAt = new Date().toISOString();
    handle.upsertProviderRecord.run(input.provider, input.id, input.spisovaZnacka, spisovaZnackaNorm, input.courtName, input.dateIssued, updatedAt);
}
export async function lookupProviderRecordsByRef(refRaw) {
    const handle = await getHandle();
    const refNorm = normalizeCaseRef(refRaw);
    const rows = handle.selectProviderRecordsByRefNorm.all(refNorm);
    return rows.map((row) => ({
        provider: row.provider,
        id: row.id,
        spisovaZnacka: row.spisova_znacka,
        courtName: row.court_name,
        dateIssued: row.date_issued
    }));
}
export async function countProviderRecords(provider) {
    const handle = await getHandle();
    if (provider) {
        const row = handle.countProviderRecordsByProvider.get(provider);
        return row?.count ?? 0;
    }
    const row = handle.countProviderRecordsAll.get();
    return row?.count ?? 0;
}
/** Trivial single-row lookup by the `(provider, id)` primary key. */
/**
 * Batched provider-record lookup, keyed `provider:id`.
 *
 * Enriching a page of search hits one at a time meant up to 50 synchronous
 * queries on the request thread — small individually, but the same shape as the
 * problem that took the server down, so it is one query per provider instead.
 */
export async function getProviderRecords(keys) {
    const out = new Map();
    if (keys.length === 0)
        return out;
    const byProvider = new Map();
    for (const key of keys) {
        const ids = byProvider.get(key.provider);
        if (ids)
            ids.push(key.id);
        else
            byProvider.set(key.provider, [key.id]);
    }
    const handle = await getHandle();
    for (const [provider, ids] of byProvider) {
        const unique = [...new Set(ids)];
        const rows = handle.db
            .prepare(`SELECT provider, id, spisova_znacka, court_name, date_issued
         FROM provider_records
         WHERE provider = ? AND id IN (${unique.map(() => "?").join(", ")})`)
            .all(provider, ...unique);
        for (const row of rows) {
            out.set(`${row.provider}:${row.id}`, {
                provider: row.provider,
                id: row.id,
                spisovaZnacka: row.spisova_znacka,
                courtName: row.court_name,
                dateIssued: row.date_issued
            });
        }
    }
    return out;
}
export async function getProviderRecord(provider, id) {
    const handle = await getHandle();
    const row = handle.selectProviderRecordByPk.get(provider, id);
    if (!row)
        return null;
    return {
        provider: row.provider,
        id: row.id,
        spisovaZnacka: row.spisova_znacka,
        courtName: row.court_name,
        dateIssued: row.date_issued
    };
}
/**
 * IDs already scanned under `scanProvider` (e.g. "ustavny") that have no
 * stored text yet under `textProvider` (e.g. "ustavny") — the backfill
 * candidate set for a text-only sweep over an already-relation-scanned corpus.
 *
 * Excludes two things so a rerun never re-offers the same id forever:
 *  1. ids that already have a `provider_texts` row (LEFT JOIN ... IS NULL);
 *  2. ids marked empty by a previous backfill attempt under the synthetic
 *     scan-log provider `${scanProvider}-text-empty` (NOT EXISTS clause) —
 *     these resolved successfully but yielded blank text, so retrying them
 *     would loop forever without this marker.
 */
export async function listScanLogIdsMissingProviderText(scanProvider, textProvider, limit) {
    if (limit <= 0)
        return [];
    const handle = await getHandle();
    const rows = handle.selectScanLogIdsMissingProviderText.all(textProvider, scanProvider, `${scanProvider}-text-empty`, limit);
    return rows.map((row) => row.source_id);
}
/**
 * Test-only helper: closes the cached handle so the next call re-opens
 * against the current working directory. Useful for tests that chdir between
 * cases.
 */
export function __closeNsudLawIndexStoreForTests() {
    if (cachedHandle) {
        cachedHandle.db.close();
        cachedHandle = null;
        cachedRoot = null;
    }
}
function mapRelationRow(row) {
    return {
        sourceProvider: row.source_provider,
        sourceId: row.source_id,
        sourceRef: row.source_ref,
        sourceCourt: row.source_court,
        targetCourt: row.target_court,
        targetRef: row.target_ref,
        targetRefNorm: row.target_ref_norm,
        relation: row.relation,
        disposition: row.disposition,
        targetDate: row.target_date,
        confidence: row.confidence,
        dispositionUpdatedAt: row.disposition_updated_at ?? null
    };
}
/**
 * Stored relations as they may be presented: a decision pointing at its own file
 * number is dropped, and a model label, where one exists, is applied on top.
 *
 * 443,622 justice rows (78 % of that provider) were written with the source's own
 * court-prefixed number as the target, and 3,199 of them carry an outcome, so a
 * lookup of "6T/206/2012" answered "quashed by K3-6T/206/2012" — itself. The
 * writers no longer produce such rows; the existing ones stay in the database and
 * are filtered here, the same validate-on-read approach as `looksLikeCaseRef`.
 * The check runs on rows already fetched by an indexed query: no extra SQL.
 *
 * Every relation reader goes through here, so every reader gets the model overlay.
 */
function presentableRelations(handle, rows) {
    const kept = [];
    for (const row of rows) {
        if (isSelfRelation(row.source_ref, row.target_ref_norm))
            continue;
        kept.push(applyModelLabel(handle, mapRelationRow(row)));
    }
    return kept;
}
/**
 * The newest model label for one relation, or null.
 *
 * `node:sqlite` is synchronous on the HTTP thread, so this must stay a primary-key
 * seek for rows already fetched — one per relation, never a scan. A label table that
 * is absent (a database from before this table, or one dropped by hand) is a no-op.
 */
function newestModelLabel(handle, row) {
    try {
        const found = handle.selectNewestModelLabel.get(row.sourceProvider, row.sourceId, row.targetRefNorm);
        return found ?? null;
    }
    catch (error) {
        if (error instanceof Error && /no such table/i.test(error.message))
            return null;
        throw error;
    }
}
/**
 * Present a relation as the model label says (design 2026-09-25, section 2). Without
 * a label the row is returned untouched — no key is added — so output is unchanged.
 * An NS/ÚS heuristic mention (`ine`) is skipped before any lookup: labels exist only
 * for their rows with an outcome, and this keeps the per-row lookups to the minority
 * that has one. Justice rows are looked up even as `ine` (section 7): regional-court
 * appellate relations get their outcome only from a label.
 */
function applyModelLabel(handle, row) {
    if (!modelLabelApplies(row.disposition, row.sourceProvider))
        return row;
    const found = newestModelLabel(handle, row);
    if (!found)
        return row;
    const classified = classifyModelLabel(row.disposition, {
        role: found.role,
        roleConfidence: found.role_confidence,
        outcome: found.outcome,
        outcomeConfidence: found.outcome_confidence
    });
    return { ...row, disposition: classified.disposition, ...classified.overlay };
}
export async function upsertDecisionRelations(input) {
    if (input.relations.length === 0)
        return;
    const handle = await getHandle();
    const sourceRefNorm = input.sourceRef ? normalizeCaseRef(input.sourceRef) : null;
    const extractedAt = new Date().toISOString();
    runInTransaction(handle.db, () => {
        for (const rel of input.relations) {
            handle.insertRelation.run(input.sourceProvider, input.sourceId, input.sourceRef, sourceRefNorm, input.sourceCourt, rel.targetCourt, rel.targetRef, rel.targetRefNormalized, rel.relation, rel.disposition, rel.targetDate, rel.confidence, extractedAt);
        }
    });
}
export async function getRelationsReviewing(targetRefNorm) {
    const handle = await getHandle();
    return presentableRelations(handle, handle.selectRelationsByTargetNorm.all(targetRefNorm));
}
/**
 * Opening characters of stored decision texts, keyed by decision id.
 *
 * Used to recover the spisová značka of records whose metadata has none (see
 * `deriveCaseRefFromHeader`). Only a prefix is read, so this stays cheap even
 * though `decisions.text` averages ~14KB per row.
 */
export async function getDecisionTextHeaders(ids, chars = 600) {
    const heads = new Map();
    const unique = [...new Set(ids.filter((id) => id.length > 0))];
    if (unique.length === 0)
        return heads;
    const handle = await getHandle();
    const CHUNK = 100;
    for (let start = 0; start < unique.length; start += CHUNK) {
        const chunk = unique.slice(start, start + CHUNK);
        const placeholders = chunk.map(() => "?").join(", ");
        const rows = handle.db
            .prepare(`SELECT id, substr(text, 1, ?) AS head FROM decisions
         WHERE id IN (${placeholders})`)
            .all(chars, ...chunk);
        for (const row of rows)
            heads.set(row.id, row.head);
        // ÚS and justice keep their text in provider_texts, and their provider_records
        // mirror is sparse — so without this their references stay unknown and their
        // validity cannot be checked at all, which is two of the three sources.
        const providerRows = handle.db
            .prepare(`SELECT id, substr(text, 1, ?) AS head FROM provider_texts
         WHERE id IN (${placeholders})`)
            .all(chars, ...chunk);
        for (const row of providerRows) {
            if (!heads.has(row.id))
                heads.set(row.id, row.head);
        }
    }
    return heads;
}
/**
 * Documents whose FTS row still holds un-normalised text.
 *
 * Every document indexed before letter-spacing collapsing existed has "z r u š u j e"
 * in its index as seven single-character tokens, so searching for the outcome finds
 * nothing. The marker table records what has been rewritten; without it the job would
 * either restart from scratch on every run or spin on the same rows.
 */
export async function listTextsNeedingFtsNormalization(limit) {
    const handle = await getHandle();
    const rows = handle.db
        .prepare(`SELECT 'nsud' AS provider, d.id AS id, d.text_sha256 AS text_sha256
       FROM decisions d
       LEFT JOIN fts_normalized n ON n.provider = 'nsud' AND n.id = d.id
       WHERE n.id IS NULL OR n.text_sha256 <> d.text_sha256
       LIMIT ?`)
        .all(limit);
    if (rows.length < limit) {
        const providerRows = handle.db
            .prepare(`SELECT pt.provider AS provider, pt.id AS id, pt.text_sha256 AS text_sha256
         FROM provider_texts pt
         LEFT JOIN fts_normalized n ON n.provider = pt.provider AND n.id = pt.id
         WHERE n.id IS NULL OR n.text_sha256 <> pt.text_sha256
         LIMIT ?`)
            .all(limit - rows.length);
        rows.push(...providerRows);
    }
    return rows.map((row) => ({ provider: row.provider, id: row.id, textSha256: row.text_sha256 }));
}
/** Rewrite one document's FTS row from its stored text, with letter-spacing collapsed. */
export async function renormalizeTextFts(target) {
    const handle = await getHandle();
    runInTransaction(handle.db, () => {
        if (target.provider === "nsud") {
            const row = handle.selectDecisionRowid.get(target.id);
            const text = handle.selectDecisionText.get(target.id);
            if (row && text) {
                handle.deleteDecisionFts.run(row.rowid);
                handle.insertDecisionFts.run(row.rowid, normalizeForFts(text.text));
            }
        }
        else {
            const row = handle.selectProviderTextRowid.get(target.provider, target.id);
            const text = handle.selectProviderText.get(target.provider, target.id);
            if (row && text) {
                handle.deleteProviderTextFts.run(row.rowid);
                handle.insertProviderTextFts.run(row.rowid, normalizeForFts(text.text));
            }
        }
        handle.upsertFtsNormalized.run(target.provider, target.id, target.textSha256, new Date().toISOString());
    });
}
export async function countFtsNormalized() {
    const handle = await getHandle();
    const row = handle.db.prepare("SELECT COUNT(*) AS count FROM fts_normalized").get();
    return row?.count ?? 0;
}
/**
 * Write an abstract, replacing any previous one for the same decision.
 *
 * The FTS row is deleted and re-inserted inside the same transaction as the base
 * row — the same pattern the text tables use, so replacing an abstract cannot leave
 * a stale FTS entry behind that would keep matching the old wording.
 */
export async function upsertDecisionAbstract(input) {
    if (!input.vyrok && !input.lead && !input.holding)
        return;
    const handle = await getHandle();
    const generatedAt = new Date().toISOString();
    runInTransaction(handle.db, () => {
        const existing = handle.db
            .prepare("SELECT rowid FROM decision_abstracts WHERE provider = ? AND id = ?")
            .get(input.provider, input.id);
        if (existing) {
            handle.db.prepare("DELETE FROM decision_abstracts_fts WHERE rowid = ?").run(existing.rowid);
        }
        handle.db
            .prepare(`INSERT INTO decision_abstracts
           (provider, id, vyrok, lead_text, holding, source, model, text_sha256, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, id) DO UPDATE SET
           vyrok = excluded.vyrok,
           lead_text = excluded.lead_text,
           holding = excluded.holding,
           source = excluded.source,
           model = excluded.model,
           text_sha256 = excluded.text_sha256,
           generated_at = excluded.generated_at`)
            .run(input.provider, input.id, input.vyrok, input.lead, input.holding ?? null, input.source, input.model ?? null, input.textSha256, generatedAt);
        const row = handle.db
            .prepare("SELECT rowid FROM decision_abstracts WHERE provider = ? AND id = ?")
            .get(input.provider, input.id);
        if (!row)
            return;
        handle.db
            .prepare("INSERT INTO decision_abstracts_fts(rowid, vyrok, lead_text, holding) VALUES (?, ?, ?, ?)")
            .run(row.rowid, input.vyrok ?? "", input.lead ?? "", input.holding ?? "");
    });
}
export async function getDecisionAbstracts(keys) {
    const out = new Map();
    if (keys.length === 0)
        return out;
    const handle = await getHandle();
    const byProvider = new Map();
    for (const key of keys) {
        const ids = byProvider.get(key.provider);
        if (ids)
            ids.push(key.id);
        else
            byProvider.set(key.provider, [key.id]);
    }
    for (const [provider, ids] of byProvider) {
        const unique = [...new Set(ids)];
        const rows = handle.db
            .prepare(`SELECT provider, id, vyrok, lead_text, holding, source
         FROM decision_abstracts
         WHERE provider = ? AND id IN (${unique.map(() => "?").join(", ")})`)
            .all(provider, ...unique);
        for (const row of rows) {
            out.set(`${row.provider}:${row.id}`, {
                provider: row.provider,
                id: row.id,
                vyrok: row.vyrok,
                lead: row.lead_text,
                holding: row.holding,
                source: row.source
            });
        }
    }
    return out;
}
/**
 * Full-text search over abstracts.
 *
 * The operative part is weighted above the reasoning opening, but not by much: the
 * outcome is what a lawyer checks first, while the subject matter of the case — what
 * a topical query actually matches — lives in the reasoning.
 */
export async function searchDecisionAbstractsFts(input) {
    const match = sanitizeFtsQuery(input.query);
    if (!match)
        return [];
    const requested = input.providers && input.providers.length > 0 ? new Set(input.providers) : null;
    const narrows = requested !== null && requested.size < 3;
    // Same shape as planProviderFtsQuery: the filter is applied in JS, so a narrowed
    // search over-fetches. Without this a request for one provider silently returned
    // another provider's decisions.
    const limit = narrows
        ? Math.min(1000, Math.max(1, input.limit) * 40)
        : Math.max(1, Math.min(100, input.limit));
    const offset = Math.max(0, input.offset);
    const sql = `
    SELECT a.provider AS provider, a.id AS id, a.vyrok AS vyrok,
           a.lead_text AS lead_text, a.holding AS holding, a.source AS source,
           bm25(decision_abstracts_fts, 1.5, 1.0, 2.0) AS rank
    FROM decision_abstracts_fts
    JOIN decision_abstracts a ON a.rowid = decision_abstracts_fts.rowid
    WHERE decision_abstracts_fts MATCH ?
    ORDER BY rank
    LIMIT ? OFFSET ?
  `;
    const params = [match, limit, offset];
    const offloaded = await tryOffloadFts({ label: "abstractFts", sql, params });
    const rows = offloaded?.rows ??
        (await getHandle()).db.prepare(sql).all(...params);
    return rows
        .filter((row) => !requested || requested.has(row.provider))
        .slice(0, Math.max(1, Math.min(100, input.limit)))
        .map((row) => ({
        provider: row.provider,
        id: row.id,
        vyrok: row.vyrok,
        lead: row.lead_text,
        holding: row.holding,
        source: row.source,
        rank: row.rank
    }));
}
/**
 * Documents whose abstract is missing or stale, for the nightly backfill.
 *
 * Staleness is decided purely by comparing the stored text hash against the
 * document's current one, so the job can be run repeatedly without doing the same
 * work twice. That also means it CANNOT see an extractor change: if a document's
 * text is unchanged, its hash still matches and it is skipped, even though a fixed
 * extractor would now produce a different abstract. Rows affected by an extractor
 * fix need a different, one-off query keyed on a symptom of the old output instead
 * — see `listAbstractsWithGluedReasoning` and `scripts/repair-glued-abstracts.ts`.
 */
export async function listDecisionsMissingAbstract(limit) {
    const handle = await getHandle();
    const rows = handle.db
        .prepare(`SELECT 'nsud' AS provider, d.id AS id, d.text AS text, d.text_sha256 AS text_sha256
       FROM decisions d
       LEFT JOIN decision_abstracts a ON a.provider = 'nsud' AND a.id = d.id
       LEFT JOIN abstract_attempts t ON t.provider = 'nsud' AND t.id = d.id
       WHERE (a.id IS NULL OR a.text_sha256 <> d.text_sha256)
         AND (t.id IS NULL OR t.text_sha256 <> d.text_sha256)
       LIMIT ?
       `)
        .all(limit);
    if (rows.length >= limit) {
        return rows.map((row) => ({ ...row, textSha256: row.text_sha256 }));
    }
    const providerRows = handle.db
        .prepare(`SELECT pt.provider AS provider, pt.id AS id, pt.text AS text, pt.text_sha256 AS text_sha256
       FROM provider_texts pt
       LEFT JOIN decision_abstracts a ON a.provider = pt.provider AND a.id = pt.id
       LEFT JOIN abstract_attempts t ON t.provider = pt.provider AND t.id = pt.id
       WHERE (a.id IS NULL OR a.text_sha256 <> pt.text_sha256)
         AND (t.id IS NULL OR t.text_sha256 <> pt.text_sha256)
       LIMIT ?`)
        .all(limit - rows.length);
    return [...rows, ...providerRows].map((row) => ({
        provider: row.provider,
        id: row.id,
        text: row.text,
        textSha256: row.text_sha256
    }));
}
/**
 * Rows whose abstract was extracted before the "odôvodnenie" heading fix (commit
 * 59d76c2) and still have the whole reasoning glued into `vyrok`, with `lead_text`
 * left NULL.
 *
 * `listDecisionsMissingAbstract` cannot find these: its staleness check compares
 * the stored TEXT hash against the current one, and for these rows the text never
 * changed — only the EXTRACTOR did. A text-hash queue has no way to notice that, so
 * these rows would otherwise stay broken forever. This is the one-off pattern for
 * that situation (see `scripts/repair-glued-abstracts.ts`): find rows by a symptom
 * of the old extractor's output (`lead_text IS NULL` and `vyrok` still contains the
 * reasoning heading text) instead of by text-hash staleness.
 *
 * Keyset pagination by `rowid` (never OFFSET) is required: OFFSET would force
 * SQLite to walk and discard every already-scanned row on every batch, so a repair
 * over a large table would get slower as it progresses. Keying off `rowid` instead
 * keeps each batch a short, bounded scan regardless of how far the repair has
 * already gotten.
 */
export async function listAbstractsWithGluedReasoning(input) {
    const handle = await getHandle();
    const rows = handle.db
        .prepare(`SELECT a.rowid AS rowid, a.provider AS provider, a.id AS id,
              COALESCE(d.text, pt.text) AS text,
              COALESCE(d.text_sha256, pt.text_sha256) AS text_sha256
       FROM decision_abstracts a
       LEFT JOIN decisions d ON a.provider = 'nsud' AND d.id = a.id
       LEFT JOIN provider_texts pt ON a.provider <> 'nsud' AND pt.provider = a.provider AND pt.id = a.id
       WHERE a.rowid > ?
         AND a.lead_text IS NULL
         AND a.vyrok LIKE '%dôvodneni%'
         AND COALESCE(d.text, pt.text) IS NOT NULL
       ORDER BY a.rowid
       LIMIT ?`)
        .all(input.afterRowid, input.limit);
    return rows.map((row) => ({
        rowid: row.rowid,
        provider: row.provider,
        id: row.id,
        text: row.text,
        textSha256: row.text_sha256
    }));
}
/**
 * Record that extraction was tried and produced nothing, so this document leaves the
 * backfill queue. Keyed by text hash: if the text changes it is retried, and dropping
 * the `abstract_attempts` table forces a full retry after the extractor improves.
 */
export async function markAbstractAttempted(input) {
    const handle = await getHandle();
    handle.db
        .prepare(`INSERT INTO abstract_attempts (provider, id, text_sha256, attempted_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider, id) DO UPDATE SET
         text_sha256 = excluded.text_sha256,
         attempted_at = excluded.attempted_at`)
        .run(input.provider, input.id, input.textSha256, new Date().toISOString());
}
export async function countAbstractAttemptsWithoutAbstract() {
    const handle = await getHandle();
    const row = handle.db
        .prepare(`SELECT COUNT(*) AS count FROM abstract_attempts t
       LEFT JOIN decision_abstracts a ON a.provider = t.provider AND a.id = t.id
       WHERE a.id IS NULL`)
        .get();
    return row?.count ?? 0;
}
export async function countDecisionAbstracts() {
    const handle = await getHandle();
    const row = handle.db.prepare("SELECT COUNT(*) AS count FROM decision_abstracts").get();
    return row?.count ?? 0;
}
/**
 * Note that a tool was called.
 *
 * Best-effort: a failure here must never break the tool call that triggered it. One
 * indexed upsert, so the cost on the request thread is negligible.
 */
export async function recordToolCall(tool) {
    if (!tool)
        return;
    try {
        const handle = await getHandle();
        const now = new Date().toISOString();
        handle.db
            .prepare(`INSERT INTO tool_calls (tool, calls, first_seen_at, last_seen_at)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(tool) DO UPDATE SET
           calls = calls + 1,
           last_seen_at = excluded.last_seen_at`)
            .run(tool, now, now);
    }
    catch (error) {
        console.error(`[tool-calls] could not record ${tool}: ${error.message}`);
    }
}
/** Call counts, busiest first. Feeds the tool-consolidation decision. */
export async function listToolCallCounts() {
    const handle = await getHandle();
    const rows = handle.db
        .prepare("SELECT tool, calls, last_seen_at FROM tool_calls ORDER BY calls DESC")
        .all();
    return rows.map((row) => ({ tool: row.tool, calls: row.calls, lastSeenAt: row.last_seen_at }));
}
/**
 * Note that the user looked this case up by name.
 *
 * Best-effort: a failure here must never break the tool call that triggered it,
 * and values that are not case references are ignored (the NS API puts
 * subject-matter text in that field — see `asCaseRef`).
 */
export async function recordRefLookup(refRaw) {
    const ref = asCaseRef(refRaw);
    if (!ref)
        return;
    try {
        const handle = await getHandle();
        const now = new Date().toISOString();
        handle.db
            .prepare(`INSERT INTO ref_lookups (ref_norm, ref_raw, lookups, first_seen_at, last_seen_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(ref_norm) DO UPDATE SET
           lookups = lookups + 1,
           ref_raw = excluded.ref_raw,
           last_seen_at = excluded.last_seen_at`)
            .run(normalizeCaseRef(ref), ref, now, now);
    }
    catch (error) {
        console.error(`[ref-lookups] could not record ${ref}: ${error.message}`);
    }
}
/** How many distinct cases have been looked up by name. Lets the weekly report's
 *  data source be verified from outside — a silently failed write would otherwise
 *  leave the implicit watchlist permanently empty with no signal. */
export async function countRefLookups() {
    const handle = await getHandle();
    const row = handle.db.prepare("SELECT COUNT(*) AS count FROM ref_lookups").get();
    return row?.count ?? 0;
}
/** Cases looked up since `sinceIso`, most recently used first. */
export async function listRefLookupsSince(sinceIso, limit) {
    const handle = await getHandle();
    const rows = handle.db
        .prepare(`SELECT ref_norm, ref_raw, lookups, last_seen_at
       FROM ref_lookups
       WHERE last_seen_at >= ?
       ORDER BY last_seen_at DESC
       LIMIT ?`)
        .all(sinceIso, limit);
    return rows.map((row) => ({
        refRaw: row.ref_raw,
        refNorm: row.ref_norm,
        lookups: row.lookups,
        lastSeenAt: row.last_seen_at
    }));
}
/**
 * Batched counterpart to `getRelationsReviewing`, keyed by normalized case ref.
 *
 * Annotating a page of search hits one ref at a time meant N synchronous queries
 * on the request thread — the same shape of problem that took the server down
 * today. One IN-list query seeks `idx_relations_target_norm` instead. Chunked so
 * the statement stays a sane size on large result pages.
 */
export async function getRelationsReviewingMany(targetRefNorms) {
    const byRef = new Map();
    const unique = [...new Set(targetRefNorms.filter((ref) => ref.length > 0))];
    if (unique.length === 0)
        return byRef;
    const handle = await getHandle();
    const CHUNK = 200;
    for (let start = 0; start < unique.length; start += CHUNK) {
        const chunk = unique.slice(start, start + CHUNK);
        const rows = handle.db
            .prepare(`SELECT source_provider, source_id, source_ref, source_court,
                target_court, target_ref, target_ref_norm, relation, disposition,
                target_date, confidence
         FROM decision_relations
         WHERE target_ref_norm IN (${chunk.map(() => "?").join(", ")})
         ORDER BY confidence DESC`)
            .all(...chunk);
        for (const mapped of presentableRelations(handle, rows)) {
            const key = mapped.targetRefNorm;
            const existing = byRef.get(key);
            if (existing)
                existing.push(mapped);
            else
                byRef.set(key, [mapped]);
        }
    }
    return byRef;
}
export async function getRelationsBySourceRef(sourceRefNorm) {
    const handle = await getHandle();
    return presentableRelations(handle, handle.selectRelationsBySourceRefNorm.all(sourceRefNorm));
}
export async function getRelationsBySource(sourceProvider, sourceId) {
    const handle = await getHandle();
    return presentableRelations(handle, handle.selectRelationsBySource.all(sourceProvider, sourceId));
}
export async function countDecisionRelations() {
    const handle = await getHandle();
    const row = handle.countRelations.get();
    return row?.count ?? 0;
}
export async function listNsudIdsMissingRelations(limit) {
    if (limit <= 0)
        return [];
    const handle = await getHandle();
    return handle.selectIdsMissingRelations.all(limit).map((row) => row.id);
}
export async function markNsudRelationsExtracted(id) {
    const handle = await getHandle();
    handle.markRelationsExtracted.run(new Date().toISOString(), id);
}
export async function countDecisionRelationsBySource(provider) {
    const handle = await getHandle();
    const row = handle.countRelationsBySource.get(provider);
    return row?.count ?? 0;
}
export async function listIneJusticeSources(limit) {
    const handle = await getHandle();
    return handle.selectIneJusticeSources.all(limit)
        .map((r) => ({ sourceId: r.source_id, sourceRef: r.source_ref }));
}
export async function updateIneRelationDisposition(input) {
    const handle = await getHandle();
    handle.updateIneDisposition.run(input.disposition, input.confidence, new Date().toISOString(), input.sourceId, input.targetRefNorm);
}
/**
 * One keyset page of justice relations joined to their source's list metadata.
 *
 * Takes the database explicitly so a diagnostic can run it against a copy opened
 * read-only. `+dr.source_provider` keeps SQLite on the rowid range instead of the
 * provider index, which would sort the whole provider on every page.
 */
export function selectJusticeRelationsWithOwnRef(db, input) {
    const rows = db
        .prepare(`SELECT dr.id AS id, dr.source_id AS source_id, dr.source_ref AS source_ref,
              dr.source_court AS source_court, dr.target_ref AS target_ref,
              dr.target_ref_norm AS target_ref_norm, dr.target_court AS target_court,
              dr.disposition AS disposition, pr.id AS pr_id,
              pr.spisova_znacka AS own_ref, pr.court_name AS own_court
       FROM decision_relations dr
       LEFT JOIN provider_records pr ON pr.provider = 'justice' AND pr.id = dr.source_id
       WHERE dr.id > ? AND +dr.source_provider = 'justice'
       ORDER BY dr.id
       LIMIT ?`)
        .all(input.afterId, input.limit);
    return rows.map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        sourceRef: row.source_ref,
        sourceCourt: row.source_court,
        targetRef: row.target_ref,
        targetRefNorm: row.target_ref_norm,
        targetCourt: row.target_court,
        disposition: row.disposition,
        hasProviderRecord: row.pr_id !== null,
        ownRef: row.own_ref,
        ownCourt: row.own_court
    }));
}
export async function listJusticeRelationsWithOwnRef(input) {
    const handle = await getHandle();
    return selectJusticeRelationsWithOwnRef(handle.db, input);
}
/** The disposition of another justice row of `sourceId` with this target, if one exists. */
export function selectOtherJusticeRelation(db, input) {
    const row = db
        .prepare(`SELECT id, disposition FROM decision_relations
       WHERE source_provider = 'justice' AND source_id = ? AND target_ref_norm = ? AND id <> ?`)
        .get(input.sourceId, input.targetRefNorm, input.id);
    return row ?? null;
}
export async function findOtherJusticeRelation(input) {
    const handle = await getHandle();
    return selectOtherJusticeRelation(handle.db, input);
}
const RELATION_COLUMNS = "id, source_provider, source_id, source_ref, source_ref_norm, source_court, target_court, " +
    "target_ref, target_ref_norm, relation, disposition, target_date, confidence, extracted_at, " +
    "disposition_updated_at";
/**
 * Before-images of every row the justice orientation repair changed or deleted, keyed
 * by repair run, so an applied repair can be undone exactly. For an update, `after_*`
 * holds the columns the repair wrote; every other column it left as logged. Rollback
 * restores a row only while it still matches that post-repair state. Created on first
 * use by the repair itself: ordinary server start-up never touches the schema for it.
 */
function ensureRelationRepairLog(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS decision_relations_repair_log (
       log_id INTEGER PRIMARY KEY AUTOINCREMENT,
       repair_run TEXT NOT NULL,
       action TEXT NOT NULL CHECK (action IN ('update', 'delete')),
       logged_at TEXT NOT NULL,
       restored_at TEXT,
       after_source_ref TEXT,
       after_source_ref_norm TEXT,
       after_source_court TEXT,
       after_target_ref TEXT,
       after_target_ref_norm TEXT,
       id INTEGER NOT NULL,
       source_provider TEXT NOT NULL,
       source_id TEXT NOT NULL,
       source_ref TEXT,
       source_ref_norm TEXT,
       source_court TEXT,
       target_court TEXT,
       target_ref TEXT NOT NULL,
       target_ref_norm TEXT NOT NULL,
       relation TEXT NOT NULL,
       disposition TEXT NOT NULL,
       target_date TEXT,
       confidence REAL NOT NULL,
       extracted_at TEXT NOT NULL,
       disposition_updated_at TEXT
     );
     CREATE INDEX IF NOT EXISTS idx_relations_repair_log_run
       ON decision_relations_repair_log(repair_run, log_id);`);
}
/**
 * Like `runInTransaction`, but takes the write lock up front (BEGIN IMMEDIATE), so a
 * repair batch that read a row cannot lose the lock to a concurrent indexer before it
 * writes; `busy_timeout` makes it wait instead.
 */
function runInImmediateTransaction(db, body) {
    db.exec("BEGIN IMMEDIATE");
    try {
        body();
        db.exec("COMMIT");
    }
    catch (error) {
        try {
            db.exec("ROLLBACK");
        }
        catch {
            // best-effort rollback; surface the original failure
        }
        throw error;
    }
}
/**
 * Rewrite inverted justice rows to the orientation `orientJusticeRelation` decided, in
 * one immediate transaction per batch, logging each row's before-image under
 * `repairRun` first (see `rollbackJusticeAppellateRepairBatch`). When the source
 * already has a row with the corrected target, the inverted row is deleted if that row
 * covers it (`existingRelationCovers`) and left alone otherwise. `target_court`,
 * `disposition`, `confidence` and `extracted_at` are kept: the original court was
 * stored right, and a fresh `extracted_at` would make every repaired row look newly
 * indexed to the weekly report.
 */
export async function fixJusticeAppellateRelations(fixes, repairRun) {
    const counts = { fixed: 0, merged: 0, conflicts: 0, disappeared: 0 };
    if (fixes.length === 0)
        return counts;
    const handle = await getHandle();
    ensureRelationRepairLog(handle.db);
    const selectCurrent = handle.db.prepare("SELECT disposition FROM decision_relations WHERE id = ? AND source_provider = 'justice'");
    const logRow = handle.db.prepare(`INSERT INTO decision_relations_repair_log
       (repair_run, action, logged_at, after_source_ref, after_source_ref_norm, after_source_court,
        after_target_ref, after_target_ref_norm, ${RELATION_COLUMNS})
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ${RELATION_COLUMNS} FROM decision_relations WHERE id = ?`);
    const update = handle.db.prepare(`UPDATE decision_relations
     SET source_ref = ?, source_ref_norm = ?, source_court = ?, target_ref = ?, target_ref_norm = ?
     WHERE id = ?`);
    const remove = handle.db.prepare("DELETE FROM decision_relations WHERE id = ?");
    const loggedAt = new Date().toISOString();
    runInImmediateTransaction(handle.db, () => {
        for (const fix of fixes) {
            const current = selectCurrent.get(fix.id);
            if (!current) {
                counts.disappeared += 1;
                continue;
            }
            const existing = selectOtherJusticeRelation(handle.db, fix);
            if (existing) {
                if (existingRelationCovers(existing, current)) {
                    logRow.run(repairRun, "delete", loggedAt, null, null, null, null, null, fix.id);
                    remove.run(fix.id);
                    counts.merged += 1;
                }
                else {
                    counts.conflicts += 1;
                }
                continue;
            }
            const sourceRefNorm = fix.sourceRef ? normalizeCaseRef(fix.sourceRef) : null;
            logRow.run(repairRun, "update", loggedAt, fix.sourceRef, sourceRefNorm, fix.sourceCourt, fix.targetRef, fix.targetRefNorm, fix.id);
            update.run(fix.sourceRef, sourceRefNorm, fix.sourceCourt, fix.targetRef, fix.targetRefNorm, fix.id);
            counts.fixed += 1;
        }
    });
    return counts;
}
/**
 * Delete these justice relation rows for `pruneJusticeInvertedNonReviews`, in one
 * immediate transaction, logging each row's before-image under `repairRun` first
 * exactly like the delete branch of `fixJusticeAppellateRelations` (same columns,
 * `after_*` NULL), so `rollbackJusticeAppellateRepairBatch` restores it the same way.
 *
 * A row is only deleted while it still exists, is still a justice row
 * (`source_provider = 'justice'`), and still has the same `target_ref_norm` and
 * `source_ref` (`IS`, so a null `source_ref` matches only another null) as when the
 * caller listed it. Any mismatch -- gone, no longer justice, or changed by the
 * indexer, the repair pass or another prune run between the caller's read and this
 * write -- is counted as `changedOrDisappeared` and left alone, never deleted on
 * stale information.
 */
export async function pruneJusticeRelations(rows, repairRun) {
    const counts = { deleted: 0, changedOrDisappeared: 0 };
    if (rows.length === 0)
        return counts;
    const handle = await getHandle();
    ensureRelationRepairLog(handle.db);
    const selectCurrent = handle.db.prepare(`SELECT 1 FROM decision_relations
     WHERE id = ? AND source_provider = 'justice' AND target_ref_norm IS ? AND source_ref IS ?`);
    const logRow = handle.db.prepare(`INSERT INTO decision_relations_repair_log
       (repair_run, action, logged_at, after_source_ref, after_source_ref_norm, after_source_court,
        after_target_ref, after_target_ref_norm, ${RELATION_COLUMNS})
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ${RELATION_COLUMNS} FROM decision_relations WHERE id = ?`);
    const remove = handle.db.prepare("DELETE FROM decision_relations WHERE id = ?");
    const loggedAt = new Date().toISOString();
    runInImmediateTransaction(handle.db, () => {
        for (const row of rows) {
            const current = selectCurrent.get(row.id, row.targetRefNorm, row.sourceRef);
            if (!current) {
                counts.changedOrDisappeared += 1;
                continue;
            }
            logRow.run(repairRun, "delete", loggedAt, null, null, null, null, null, row.id);
            remove.run(row.id);
            counts.deleted += 1;
        }
    });
    return counts;
}
/**
 * Undo one page of a repair run, newest log entry first: each logged row is put back
 * exactly as it was (same id and columns), whether the repair updated or deleted it.
 *
 * Newer data always wins. An updated row that no longer matches what the repair left
 * (the disposition enricher found its outcome, the indexer upserted it, it was
 * deleted) is skipped and counted as `changedSinceRepair`. A restore that would
 * collide with another row on the (source_provider, source_id, target_ref_norm) key
 * is counted as a conflict. Both are left for a human. Dry run (apply false) only
 * counts. Restored entries are stamped, so a finished rollback has nothing left to do.
 */
export async function rollbackJusticeAppellateRepairBatch(input) {
    const handle = await getHandle();
    ensureRelationRepairLog(handle.db);
    const entries = handle.db
        .prepare(`SELECT log_id, action, ${RELATION_COLUMNS} FROM decision_relations_repair_log
       WHERE repair_run = ? AND log_id < ? AND restored_at IS NULL
       ORDER BY log_id DESC
       LIMIT ?`)
        .all(input.repairRun, input.beforeLogId, input.limit);
    const result = {
        entries: entries.length,
        restored: 0,
        conflicts: 0,
        changedSinceRepair: 0,
        nextBefore: entries.length < input.limit ? null : entries[entries.length - 1].log_id
    };
    if (entries.length === 0)
        return result;
    // The row exactly as the repair left it: `after_*` for what it wrote, the logged
    // before-image for every column it did not touch. `IS` compares NULLs as equal.
    const unchanged = handle.db.prepare(`SELECT 1 FROM decision_relations d
     JOIN decision_relations_repair_log l ON l.log_id = ?
     WHERE d.id = l.id
       AND d.source_provider IS l.source_provider AND d.source_id IS l.source_id
       AND d.source_ref IS l.after_source_ref AND d.source_ref_norm IS l.after_source_ref_norm
       AND d.source_court IS l.after_source_court AND d.target_ref IS l.after_target_ref
       AND d.target_ref_norm IS l.after_target_ref_norm AND d.target_court IS l.target_court
       AND d.relation IS l.relation AND d.disposition IS l.disposition
       AND d.target_date IS l.target_date AND d.confidence IS l.confidence
       AND d.extracted_at IS l.extracted_at AND d.disposition_updated_at IS l.disposition_updated_at`);
    const idTaken = handle.db.prepare("SELECT 1 FROM decision_relations WHERE id = ?");
    const clash = handle.db.prepare(`SELECT 1 FROM decision_relations
     WHERE source_provider = ? AND source_id = ? AND target_ref_norm = ? AND id <> ?`);
    const remove = handle.db.prepare("DELETE FROM decision_relations WHERE id = ?");
    const insert = handle.db.prepare(`INSERT INTO decision_relations (${RELATION_COLUMNS})
     SELECT ${RELATION_COLUMNS} FROM decision_relations_repair_log WHERE log_id = ?`);
    const stamp = handle.db.prepare("UPDATE decision_relations_repair_log SET restored_at = ? WHERE log_id = ?");
    const restoredAt = new Date().toISOString();
    const restore = () => {
        for (const entry of entries) {
            const changed = entry.action === "update" ? !unchanged.get(entry.log_id) : Boolean(idTaken.get(entry.id));
            if (changed) {
                result.changedSinceRepair += 1;
                continue;
            }
            if (clash.get(entry.source_provider, entry.source_id, entry.target_ref_norm, entry.id)) {
                result.conflicts += 1;
                continue;
            }
            if (!input.apply)
                continue;
            remove.run(entry.id);
            insert.run(entry.log_id);
            stamp.run(restoredAt, entry.log_id);
            result.restored += 1;
        }
    };
    if (input.apply)
        runInImmediateTransaction(handle.db, restore);
    else
        restore();
    return result;
}
/** relation_scan_log key recording that the orientation repair re-fetched a decision. */
export const JUSTICE_REFETCH_SCAN_PROVIDER = "justice-refetch";
/**
 * One keyset page (by source_id) of justice scan-log entries written on or after
 * `scannedSince` and before `scannedBefore` (null: no upper bound) whose decision has no relation row as source and has not been
 * re-fetched by the orientation repair yet. Walks the scan log's primary key; each
 * page reads at most `limit` log rows. `nextAfter` is the last source_id examined, or
 * null when the log is exhausted.
 */
export function selectScannedJusticeWithoutRelation(db, input) {
    const page = db
        .prepare(`SELECT sl.source_id AS source_id, sl.scanned_at AS scanned_at,
              pr.spisova_znacka AS own_ref, pr.court_name AS court_name,
              EXISTS (SELECT 1 FROM decision_relations dr
                      WHERE dr.source_provider = 'justice' AND dr.source_id = sl.source_id) AS has_relation,
              EXISTS (SELECT 1 FROM relation_scan_log rf
                      WHERE rf.provider = '${JUSTICE_REFETCH_SCAN_PROVIDER}' AND rf.source_id = sl.source_id) AS refetched
       FROM relation_scan_log sl
       LEFT JOIN provider_records pr ON pr.provider = 'justice' AND pr.id = sl.source_id
       WHERE sl.provider = 'justice' AND sl.source_id > ?
       ORDER BY sl.source_id
       LIMIT ?`)
        .all(input.afterSourceId, input.limit);
    const rows = page
        .filter((row) => row.scanned_at >= input.scannedSince &&
        (input.scannedBefore === null || row.scanned_at < input.scannedBefore) &&
        row.has_relation === 0 &&
        row.refetched === 0)
        .map((row) => ({ sourceId: row.source_id, ownRef: row.own_ref, courtName: row.court_name }));
    return { rows, nextAfter: page.length < input.limit ? null : page[page.length - 1].source_id };
}
export async function listScannedJusticeWithoutRelation(input) {
    const handle = await getHandle();
    return selectScannedJusticeWithoutRelation(handle.db, input);
}
export async function markNsudTextAttempted(id) {
    const handle = await getHandle();
    handle.markTextAttempted.run(new Date().toISOString(), id);
}
export async function markRelationScanDone(provider, sourceId) {
    const handle = await getHandle();
    handle.insertScanLog.run(provider, sourceId, new Date().toISOString());
}
export async function filterUnscanned(provider, ids) {
    if (ids.length === 0)
        return [];
    const handle = await getHandle();
    const out = [];
    for (const id of ids) {
        const hit = handle.selectScanLogHits.get(provider, id);
        if (!hit)
            out.push(id);
    }
    return out;
}
export async function countRelationScanLog(provider) {
    const handle = await getHandle();
    const row = handle.countScanLog.get(provider);
    return row?.count ?? 0;
}
export async function saveCrawlState(provider, payload) {
    const handle = await getHandle();
    handle.upsertCrawlState.run(provider, JSON.stringify(payload));
}
export async function loadCrawlState(provider) {
    const handle = await getHandle();
    const row = handle.selectCrawlState.get(provider);
    if (!row)
        return null;
    try {
        return JSON.parse(row.payload);
    }
    catch {
        return null;
    }
}
export async function recordStatsSnapshot(payload) {
    const handle = await getHandle();
    handle.insertStatsSnapshot.run(new Date().toISOString(), JSON.stringify(payload));
}
export async function getLatestStatsSnapshot() {
    const handle = await getHandle();
    const row = handle.selectLatestStatsSnapshot.get();
    if (!row)
        return null;
    try {
        return { takenAt: row.taken_at, payload: JSON.parse(row.payload) };
    }
    catch {
        return null;
    }
}
export async function recordJobRun(job, summary) {
    const handle = await getHandle();
    handle.upsertJobRun.run(job, new Date().toISOString(), JSON.stringify(summary));
}
export async function listJobRuns() {
    const handle = await getHandle();
    return handle.selectJobRuns.all().map((r) => {
        let summary = {};
        try {
            summary = JSON.parse(r.payload);
        }
        catch { /* keep {} */ }
        return { job: r.job, lastRunAt: r.last_run_at, summary };
    });
}
export async function addWatchlistEntry(refRaw, note) {
    const handle = await getHandle();
    const refNorm = normalizeCaseRef(refRaw);
    handle.upsertWatchlist.run(refNorm, refRaw.trim(), note ?? null, new Date().toISOString());
    const rows = handle.selectWatchlist.all();
    const row = rows.find((r) => r.ref_norm === refNorm);
    return { refNorm: row.ref_norm, refRaw: row.ref_raw, note: row.note, addedAt: row.added_at };
}
export async function removeWatchlistEntry(refRaw) {
    const handle = await getHandle();
    const before = handle.selectWatchlist.all().length;
    handle.deleteWatchlist.run(normalizeCaseRef(refRaw));
    return handle.selectWatchlist.all().length < before;
}
export async function listWatchlistEntries() {
    const handle = await getHandle();
    return handle.selectWatchlist.all()
        .map((r) => ({ refNorm: r.ref_norm, refRaw: r.ref_raw, note: r.note, addedAt: r.added_at }));
}
export async function listRelationsExtractedSince(sinceIso, limit) {
    const handle = await getHandle();
    // The LIMIT applies before the self-reference filter, so fewer rows may come back.
    return presentableRelations(handle, handle.selectRelationsSince.all(sinceIso, sinceIso, limit));
}
export async function countRelationsByDisposition() {
    const handle = await getHandle();
    const rows = handle.selectRelationDispositionCounts.all();
    const out = {};
    for (const r of rows)
        out[r.disposition] = r.count;
    return out;
}
/**
 * Write model labels in one transaction. Idempotent: a label is keyed by the relation's
 * natural key plus its run, so re-importing the same run overwrites, never duplicates.
 * A label whose relation does not exist yet is stored anyway — the read path only ever
 * joins existing relations, and a later re-extraction that recreates it picks it up.
 */
export async function upsertRelationModelLabels(labels) {
    if (labels.length === 0)
        return 0;
    const handle = await getHandle();
    runInTransaction(handle.db, () => {
        for (const label of labels) {
            handle.upsertModelLabel.run(label.sourceProvider, label.sourceId, label.targetRefNorm, label.labelRun, label.model, label.role, label.roleConfidence, label.outcome, label.outcomeConfidence, label.questionVersions, label.labelledAt);
        }
    });
    return labels.length;
}
// Pages by the decision_relations primary key; the label EXISTS and the attempts subquery
// both hit the leading columns of their tables' primary keys, so a page stays cheap even
// on a million-row relation table.
const LABELLING_CANDIDATE_SELECT = `
  SELECT dr.id, dr.source_provider, dr.source_id, dr.source_ref_norm, dr.target_ref, dr.target_ref_norm, dr.relation, dr.disposition,
         pr.spisova_znacka_norm AS portal_norm, pr.court_name AS portal_court,
         EXISTS (SELECT 1 FROM relation_model_labels l
                 WHERE l.source_provider = dr.source_provider AND l.source_id = dr.source_id
                   AND l.target_ref_norm = dr.target_ref_norm) AS has_label,
         (SELECT group_concat(a.stream) FROM relation_label_attempts a
           WHERE a.source_provider = dr.source_provider AND a.source_id = dr.source_id
             AND a.target_ref_norm = dr.target_ref_norm) AS attempted
  FROM decision_relations dr
  LEFT JOIN provider_records pr ON pr.provider = dr.source_provider AND pr.id = dr.source_id`;
function toLabellingCandidate(row) {
    return {
        id: Number(row.id),
        sourceProvider: row.source_provider,
        sourceId: row.source_id,
        sourceRefNorm: row.source_ref_norm,
        targetRef: row.target_ref,
        targetRefNorm: row.target_ref_norm,
        relation: row.relation,
        disposition: row.disposition,
        portalRefNorm: row.portal_norm,
        portalCourtName: row.portal_court,
        hasLabel: Number(row.has_label) === 1,
        attemptedStreams: row.attempted ? row.attempted.split(",") : []
    };
}
/** One page of relations for the nightly label job, ordered by row id, after `afterId`. */
export async function listRelationLabellingCandidates(afterId, limit) {
    const handle = await getHandle();
    const rows = handle.db
        .prepare(`${LABELLING_CANDIDATE_SELECT} WHERE dr.id > ? ORDER BY dr.id LIMIT ?`)
        .all(afterId, limit);
    return rows.map(toLabellingCandidate);
}
/** The same candidate shape for one relation, or null when the relation does not exist. */
export async function getRelationLabellingCandidate(key) {
    const handle = await getHandle();
    const row = handle.db
        .prepare(`${LABELLING_CANDIDATE_SELECT}
       WHERE dr.source_provider = ? AND dr.source_id = ? AND dr.target_ref_norm = ?`)
        .get(key.sourceProvider, key.sourceId, key.targetRefNorm);
    return row ? toLabellingCandidate(row) : null;
}
/** Record one look at a relation/stream: first time tries=1, later times tries+1 and the newest outcome. */
export async function recordRelationLabelAttempt(input) {
    const handle = await getHandle();
    handle.db
        .prepare(`INSERT INTO relation_label_attempts
         (source_provider, source_id, target_ref_norm, stream, status, tries, last_attempt_at, detail)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT (source_provider, source_id, target_ref_norm, stream) DO UPDATE SET
         status = excluded.status, tries = relation_label_attempts.tries + 1,
         last_attempt_at = excluded.last_attempt_at, detail = excluded.detail`)
        .run(input.sourceProvider, input.sourceId, input.targetRefNorm, input.stream, input.status, input.at, input.detail);
}
/** Attempts worth another try: transient statuses, old enough, and still under the try cap. */
export async function listRetryableRelationLabelAttempts(input) {
    const handle = await getHandle();
    const rows = handle.db
        .prepare(`SELECT source_provider, source_id, target_ref_norm, stream, status, tries, last_attempt_at, detail
       FROM relation_label_attempts
       WHERE status IN ('no_text', 'no_vyrok', 'error') AND last_attempt_at < ? AND tries < ?
       ORDER BY last_attempt_at
       LIMIT ?`)
        .all(input.olderThan, input.maxTries, input.limit);
    return rows.map((r) => ({
        sourceProvider: r.source_provider,
        sourceId: r.source_id,
        targetRefNorm: r.target_ref_norm,
        stream: r.stream,
        status: r.status,
        tries: Number(r.tries),
        lastAttemptAt: r.last_attempt_at,
        detail: r.detail
    }));
}
/** Number of labels stored for one run; used by the offline rollback, never by the server. */
export async function countRelationModelLabelRun(labelRun) {
    const handle = await getHandle();
    const row = handle.db
        .prepare("SELECT COUNT(*) AS count FROM relation_model_labels WHERE label_run = ?")
        .get(labelRun);
    return row?.count ?? 0;
}
/**
 * Remove every label of one run, and its persisted counts; other runs are untouched.
 * Deletes in small batches, each its own short transaction, so a 244k-row run never
 * holds the write lock long enough to stall the server. Returns the rows deleted.
 */
export async function deleteRelationModelLabelRun(labelRun, batch = 5000) {
    const handle = await getHandle();
    const size = Math.max(1, Math.floor(batch));
    let deleted = 0;
    for (;;) {
        const changes = Number(handle.deleteModelLabelRunBatch.run(labelRun, size).changes);
        deleted += changes;
        if (changes === 0)
            break;
        // Let other work on this process run between batches.
        await new Promise((resolve) => setImmediate(resolve));
    }
    handle.db.prepare("DELETE FROM relation_model_label_runs WHERE label_run = ?").run(labelRun);
    return deleted;
}
export async function getRelationDispositionByKey(key) {
    const handle = await getHandle();
    const row = handle.selectRelationByNaturalKey.get(key.sourceProvider, key.sourceId, key.targetRefNorm);
    return row?.disposition ?? null;
}
/**
 * Recompute and persist one run's effect counts. Offline only (the label import):
 * it walks every label of the run and joins its relation. Counts follow the read
 * path (`modelLabelApplies`): a label on a missing relation, or on an NS/ÚS heuristic
 * mention, has no effect.
 * A run with no labels left loses its row.
 */
export async function recomputeRelationModelLabelRunStats(labelRun) {
    const handle = await getHandle();
    const stats = {
        labelRun,
        labelled: 0,
        hidden: 0,
        corrected: 0,
        verified: 0,
        uncertain: 0,
        importedAt: new Date().toISOString()
    };
    const rows = handle.db
        .prepare(`SELECT l.source_provider AS source_provider, l.role AS role,
              l.role_confidence AS role_confidence, l.outcome AS outcome,
              l.outcome_confidence AS outcome_confidence, r.disposition AS disposition
       FROM relation_model_labels l
       LEFT JOIN decision_relations r
         ON r.source_provider = l.source_provider
        AND r.source_id = l.source_id
        AND r.target_ref_norm = l.target_ref_norm
       WHERE l.label_run = ?`)
        .iterate(labelRun);
    for (const row of rows) {
        stats.labelled += 1;
        if (row.disposition === null || !modelLabelApplies(row.disposition, row.source_provider))
            continue;
        const { effect } = classifyModelLabel(row.disposition, {
            role: row.role,
            roleConfidence: row.role_confidence,
            outcome: row.outcome,
            outcomeConfidence: row.outcome_confidence
        });
        stats[effect] += 1;
    }
    if (stats.labelled === 0) {
        handle.db.prepare("DELETE FROM relation_model_label_runs WHERE label_run = ?").run(labelRun);
        return null;
    }
    handle.db
        .prepare(`INSERT INTO relation_model_label_runs
         (label_run, labelled, hidden, corrected, verified, uncertain, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(label_run) DO UPDATE SET
         labelled = excluded.labelled, hidden = excluded.hidden,
         corrected = excluded.corrected, verified = excluded.verified,
         uncertain = excluded.uncertain, imported_at = excluded.imported_at`)
        .run(labelRun, stats.labelled, stats.hidden, stats.corrected, stats.verified, stats.uncertain, stats.importedAt);
    return stats;
}
/**
 * Persisted per-run counts — a few rows, never the label table itself. Null when the
 * table is absent or empty, so the stats output is unchanged until labels are imported.
 */
export async function listRelationModelLabelRuns() {
    const handle = await getHandle();
    let rows;
    try {
        rows = handle.db
            .prepare(`SELECT label_run, labelled, hidden, corrected, verified, uncertain, imported_at
         FROM relation_model_label_runs ORDER BY label_run`)
            .all();
    }
    catch (error) {
        if (error instanceof Error && /no such table/i.test(error.message))
            return null;
        throw error;
    }
    if (rows.length === 0)
        return null;
    return rows.map((row) => ({
        labelRun: row.label_run,
        labelled: row.labelled,
        hidden: row.hidden,
        corrected: row.corrected,
        verified: row.verified,
        uncertain: row.uncertain,
        importedAt: row.imported_at
    }));
}
//# sourceMappingURL=law-index-store.js.map