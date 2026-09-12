import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { asCaseRef, normalizeCaseRef } from "../../domain/relation-extractor.js";
import { normalizeForFts } from "../../domain/text-normalization.js";
import { buildNsudFtsSql, mapNsudFtsRows, mapProviderFtsRows, normalizeFtsParams, planProviderFtsQuery, sanitizeFtsQuery } from "./fts-queries.js";
import { QueryWorkerUnavailableError, isQueryWorkerEnabled, runReadQueryOnWorker } from "./query-worker-client.js";
const STATE_ROW_ID = 1;
let cachedHandle = null;
let cachedRoot = null;
function getIndexRoot() {
    return path.resolve(process.cwd(), ".cache", "judiciary", "nsud", "law-index");
}
function getDatabasePath() {
    return path.join(getIndexRoot(), "index.sqlite");
}
/** Resolved lazily so the query worker picks up the cwd in force when it spawns. */
export function getIndexDatabasePath() {
    return getDatabasePath();
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
    const db = new DatabaseSync(getDatabasePath());
    db.exec("PRAGMA journal_mode = WAL;");
    // Concurrent nightly indexers (NS text / NS relations / ÚS / justice) can write
    // the same DB at once; wait for the lock instead of throwing SQLITE_BUSY.
    db.exec("PRAGMA busy_timeout = 30000;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA synchronous = NORMAL;");
    initSchema(db);
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
       LIMIT ?`)
    };
    cachedHandle = handle;
    cachedRoot = root;
    await migrateLegacyJsonIfNeeded(root, handle);
    return handle;
}
function initSchema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS records (
       id TEXT PRIMARY KEY,
       ecli TEXT,
       spisova_znacka TEXT,
       date_issued TEXT,
       updated_at TEXT NOT NULL
     );

     -- Serves search_decisions(provider="nsud", dateFrom/dateTo, no text criterion)
     -- straight from this table instead of the NS SR portal, which ignores
     -- art_datum_od/art_datum_do and always returns the same first page. Without
     -- this index a date-range query is a full scan of every NS record.
     CREATE INDEX IF NOT EXISTS idx_records_date_issued ON records(date_issued);

     CREATE TABLE IF NOT EXISTS record_tokens (
       record_id TEXT NOT NULL,
       token TEXT NOT NULL,
       PRIMARY KEY (record_id, token),
       FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE
     );

     CREATE INDEX IF NOT EXISTS idx_record_tokens_token ON record_tokens(token);

     CREATE TABLE IF NOT EXISTS state (
       id INTEGER PRIMARY KEY,
       payload TEXT NOT NULL
     );

     CREATE TABLE IF NOT EXISTS decisions (
       id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
       text TEXT NOT NULL,
       text_sha256 TEXT NOT NULL,
       source_mode TEXT NOT NULL,
       indexed_at TEXT NOT NULL
     );

     CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
       text,
       tokenize = 'unicode61 remove_diacritics 2'
     );

     CREATE TABLE IF NOT EXISTS decision_relations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
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
       UNIQUE(source_provider, source_id, target_ref_norm)
     );

     CREATE INDEX IF NOT EXISTS idx_relations_target_norm
       ON decision_relations(target_ref_norm);
     CREATE INDEX IF NOT EXISTS idx_relations_source_ref_norm
       ON decision_relations(source_ref_norm);
     CREATE INDEX IF NOT EXISTS idx_relations_source
       ON decision_relations(source_provider, source_id);

     CREATE TABLE IF NOT EXISTS relation_scan_log (
       provider TEXT NOT NULL,
       source_id TEXT NOT NULL,
       scanned_at TEXT NOT NULL,
       PRIMARY KEY (provider, source_id)
     );

     CREATE TABLE IF NOT EXISTS crawl_state (
       provider TEXT PRIMARY KEY,
       payload TEXT NOT NULL
     );

     CREATE TABLE IF NOT EXISTS stats_snapshots (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       taken_at TEXT NOT NULL,
       payload TEXT NOT NULL
     );

     CREATE TABLE IF NOT EXISTS job_runs (
       job TEXT PRIMARY KEY,
       last_run_at TEXT NOT NULL,
       payload TEXT NOT NULL
     );

     CREATE TABLE IF NOT EXISTS watchlist (
       ref_norm TEXT PRIMARY KEY,
       ref_raw TEXT NOT NULL,
       note TEXT,
       added_at TEXT NOT NULL
     );

     -- Deterministic abstracts: the operative part and the opening of the reasoning,
     -- indexed separately from the full text because that is where the holding lives
     -- and because a hit then costs ~40-90 tokens instead of thousands.
     --
     -- The holding column is reserved for a model-written právna veta and stays NULL
     -- for now; source and model record which producer wrote a row, so an LLM pass can
     -- be added later without touching this schema. text_sha256 makes re-extraction
     -- idempotent: a document whose text has not changed is skipped.
     CREATE TABLE IF NOT EXISTS decision_abstracts (
       rowid INTEGER PRIMARY KEY AUTOINCREMENT,
       provider TEXT NOT NULL,
       id TEXT NOT NULL,
       vyrok TEXT,
       lead_text TEXT,
       holding TEXT,
       source TEXT NOT NULL,
       model TEXT,
       text_sha256 TEXT NOT NULL,
       generated_at TEXT NOT NULL,
       UNIQUE(provider, id)
     );

     -- Documents the extractor could not make an abstract from. Without this they
     -- stay at the head of the backfill queue and come back in every batch, so once
     -- their number exceeds the batch size the job stops making progress entirely —
     -- silently, because it still reports work attempted. Keyed by text hash so a
     -- changed document is retried, and the whole table can be dropped to force a
     -- full retry after the extractor improves.
     -- Which documents' FTS rows have been rewritten with letter-spacing collapsed.
     -- Everything indexed before that existed has "z r u š u j e" in the index as
     -- seven single-character tokens, so the outcome of a decision is unsearchable.
     CREATE TABLE IF NOT EXISTS fts_normalized (
       provider TEXT NOT NULL,
       id TEXT NOT NULL,
       text_sha256 TEXT NOT NULL,
       normalized_at TEXT NOT NULL,
       PRIMARY KEY (provider, id)
     );

     CREATE TABLE IF NOT EXISTS abstract_attempts (
       provider TEXT NOT NULL,
       id TEXT NOT NULL,
       text_sha256 TEXT NOT NULL,
       attempted_at TEXT NOT NULL,
       PRIMARY KEY (provider, id)
     );

     CREATE VIRTUAL TABLE IF NOT EXISTS decision_abstracts_fts USING fts5(
       vyrok,
       lead_text,
       holding,
       tokenize = 'unicode61 remove_diacritics 2'
     );

     -- Tool usage counts. The repo has ~24 tools, 7 of which are variants of "read the
     -- decision text", and the documented Tool Consolidation Gate says the collapse
     -- decision waits for usage data rather than guesswork. Nothing was counting, so the
     -- data could never arrive; this starts the clock.
     CREATE TABLE IF NOT EXISTS tool_calls (
       tool TEXT PRIMARY KEY,
       calls INTEGER NOT NULL DEFAULT 0,
       first_seen_at TEXT NOT NULL,
       last_seen_at TEXT NOT NULL
     );

     -- Case refs the user deliberately looked up by name. Looking a case up is a
     -- much better signal of "I rely on this" than a search hit is, so this acts
     -- as an implicit watchlist for the weekly report without asking the user to
     -- maintain one by hand.
     CREATE TABLE IF NOT EXISTS ref_lookups (
       ref_norm TEXT PRIMARY KEY,
       ref_raw TEXT NOT NULL,
       lookups INTEGER NOT NULL DEFAULT 1,
       first_seen_at TEXT NOT NULL,
       last_seen_at TEXT NOT NULL
     );

     CREATE TABLE IF NOT EXISTS provider_texts (
       rowid INTEGER PRIMARY KEY AUTOINCREMENT,
       provider TEXT NOT NULL,
       id TEXT NOT NULL,
       text TEXT NOT NULL,
       text_sha256 TEXT NOT NULL,
       source_mode TEXT NOT NULL,
       indexed_at TEXT NOT NULL,
       text_complete INTEGER NOT NULL DEFAULT 0,
       UNIQUE(provider, id)
     );

     CREATE VIRTUAL TABLE IF NOT EXISTS provider_texts_fts USING fts5(
       text,
       tokenize = 'unicode61 remove_diacritics 2'
     );

     CREATE TABLE IF NOT EXISTS provider_records (
       provider TEXT NOT NULL,
       id TEXT NOT NULL,
       spisova_znacka TEXT,
       spisova_znacka_norm TEXT,
       court_name TEXT,
       date_issued TEXT,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (provider, id)
     );
     CREATE INDEX IF NOT EXISTS idx_provider_records_ref_norm ON provider_records(spisova_znacka_norm);`);
    // Migration: relation-scan marker on decisions (added in Phase 2a).
    // ALTER ADD COLUMN throws "duplicate column name" if already present — ignore.
    try {
        db.exec("ALTER TABLE decisions ADD COLUMN relation_extracted_at TEXT;");
    }
    catch {
        // column already exists
    }
    // Migration: text-attempt marker on records (added in Phase 2 text-accel).
    // ALTER ADD COLUMN throws "duplicate column name" if already present — ignore.
    try {
        db.exec("ALTER TABLE records ADD COLUMN text_attempted_at TEXT;");
    }
    catch {
        // column already exists
    }
    // Migration: disposition-update marker on decision_relations (so the enricher's
    // upgrades from "ine" to a real outcome are visible to freshness queries).
    // ALTER ADD COLUMN throws "duplicate column name" if already present — ignore.
    try {
        db.exec("ALTER TABLE decision_relations ADD COLUMN disposition_updated_at TEXT;");
    }
    catch {
        // column already exists
    }
    // Migration: whole-document marker on provider_texts. The justice disposition
    // enricher stores a 20,000-char window, so a row is not necessarily the whole
    // judgment; the text read path may only serve rows it knows are complete.
    // Existing rows default to 0 and are upgraded the first time they are read.
    // ALTER ADD COLUMN throws "duplicate column name" if already present — ignore.
    try {
        db.exec("ALTER TABLE provider_texts ADD COLUMN text_complete INTEGER NOT NULL DEFAULT 0;");
    }
    catch {
        // column already exists
    }
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
    return handle.selectRelationsByTargetNorm.all(targetRefNorm).map(mapRelationRow);
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
 * Staleness is decided by comparing the stored text hash, so a re-extraction after
 * an extractor change only touches what actually needs it and the job can be run
 * repeatedly without doing the same work twice.
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
        for (const raw of rows) {
            const mapped = mapRelationRow(raw);
            const key = raw.target_ref_norm;
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
    return handle.selectRelationsBySourceRefNorm.all(sourceRefNorm).map(mapRelationRow);
}
export async function getRelationsBySource(sourceProvider, sourceId) {
    const handle = await getHandle();
    return handle.selectRelationsBySource.all(sourceProvider, sourceId).map(mapRelationRow);
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
    return handle.selectRelationsSince.all(sinceIso, sinceIso, limit).map(mapRelationRow);
}
export async function countRelationsByDisposition() {
    const handle = await getHandle();
    const rows = handle.selectRelationDispositionCounts.all();
    const out = {};
    for (const r of rows)
        out[r.disposition] = r.count;
    return out;
}
//# sourceMappingURL=law-index-store.js.map