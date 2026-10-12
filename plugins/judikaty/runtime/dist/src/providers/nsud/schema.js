/**
 * Schema version stored in PRAGMA user_version. Today's schema (everything
 * initSchema creates, including its ad-hoc ALTERs) is version 1.
 */
export const SCHEMA_VERSION = 1;
/** Version 1 has no steps; later versions append here in ascending order. */
export const MIGRATIONS = [];
export class IndexSchemaTooNewError extends Error {
    constructor(found, supported) {
        super(`index was created by a newer version (schema ${found}); this build supports up to ${supported} — update the server`);
        this.name = "IndexSchemaTooNewError";
    }
}
export function readSchemaVersion(db) {
    const row = db.prepare("PRAGMA user_version").get();
    return row?.user_version ?? 0;
}
function writeSchemaVersion(db, version) {
    // PRAGMA does not accept bound parameters; the value is an integer we control.
    db.exec(`PRAGMA user_version = ${Math.trunc(version)}`);
}
/**
 * Brings user_version up to `target`. Runs on every server start against the
 * production DB, so the version-1 path must stay a single O(1) pragma write.
 */
export function applySchemaVersion(db, migrations = MIGRATIONS, target = SCHEMA_VERSION) {
    let stored = readSchemaVersion(db);
    if (stored > target) {
        throw new IndexSchemaTooNewError(stored, target);
    }
    if (stored === 0) {
        // initSchema already ran, so a pre-versioning database is exactly version 1.
        writeSchemaVersion(db, 1);
        stored = 1;
    }
    const pending = migrations
        .filter((migration) => migration.to > stored && migration.to <= target)
        .sort((a, b) => a.to - b.to);
    for (const migration of pending) {
        stored = runMigrationStep(db, migration);
    }
    return stored;
}
/**
 * Runs one step in its own transaction, so a failure leaves the last completed version.
 * The version is read again under the write lock: the server and a nightly job can
 * open the same file at once, both see the old version, and the one that gets the lock
 * second must skip a step the first has already applied instead of running it twice.
 * Returns the version after the step (or the newer one found).
 */
export function runMigrationStep(db, migration) {
    db.exec("BEGIN IMMEDIATE");
    try {
        const current = readSchemaVersion(db);
        if (current >= migration.to) {
            db.exec("COMMIT");
            return current;
        }
        migration.up(db);
        writeSchemaVersion(db, migration.to);
        db.exec("COMMIT");
        return migration.to;
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}
export function initSchema(db) {
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
     CREATE INDEX IF NOT EXISTS idx_provider_records_ref_norm ON provider_records(spisova_znacka_norm);

     -- Model labels for decision_relations rows, applied on read (see
     -- docs/superpowers/specs/2026-09-25-model-treatment-layer-design.md). Keyed by
     -- the relation's natural key, not its row id, so labels survive re-extraction
     -- and index rebuilds. Several label runs may coexist; the newest one per key is
     -- used. Nothing in decision_relations is ever rewritten by this.
     CREATE TABLE IF NOT EXISTS relation_model_labels (
       source_provider  TEXT NOT NULL,
       source_id        TEXT NOT NULL,
       target_ref_norm  TEXT NOT NULL,
       label_run        TEXT NOT NULL,
       model            TEXT NOT NULL,
       role             TEXT NOT NULL,
       role_confidence  REAL NOT NULL,
       outcome          TEXT,
       outcome_confidence REAL,
       question_versions TEXT NOT NULL,
       labelled_at      TEXT NOT NULL,
       PRIMARY KEY (source_provider, source_id, target_ref_norm, label_run)
     );
     -- Serves the batched rollback of one run.
     CREATE INDEX IF NOT EXISTS idx_relation_model_labels_run
       ON relation_model_labels(label_run);

     -- Per-run effect counts, written by the offline import and removed by its
     -- rollback, so get_treatment_index_stats reads a handful of rows instead of
     -- scanning the label table on the request thread.
     CREATE TABLE IF NOT EXISTS relation_model_label_runs (
       label_run   TEXT PRIMARY KEY,
       labelled    INTEGER NOT NULL,
       hidden      INTEGER NOT NULL,
       corrected   INTEGER NOT NULL,
       verified    INTEGER NOT NULL,
       uncertain   INTEGER NOT NULL,
       imported_at TEXT NOT NULL
     );

     -- Nightly label job bookkeeping (design 2026-10-03): one row per relation and stream
     -- that the job looked at and did not merely skip. Final statuses stop re-sending;
     -- no_text / no_vyrok / error are retried a bounded number of times.
     CREATE TABLE IF NOT EXISTS relation_label_attempts (
       source_provider TEXT NOT NULL,
       source_id       TEXT NOT NULL,
       target_ref_norm TEXT NOT NULL,
       stream          TEXT NOT NULL,
       status          TEXT NOT NULL,
       tries           INTEGER NOT NULL,
       last_attempt_at TEXT NOT NULL,
       detail          TEXT,
       PRIMARY KEY (source_provider, source_id, target_ref_norm, stream)
     );
     CREATE INDEX IF NOT EXISTS idx_relation_label_attempts_retry
       ON relation_label_attempts(status, last_attempt_at);`);
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
//# sourceMappingURL=schema.js.map