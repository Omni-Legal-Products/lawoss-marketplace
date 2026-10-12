import { createHash } from "node:crypto";
import { FORM_NORMALIZATION_VERSION, FORM_PARSER_VERSION, FORM_RULE_VERSION, unknownFormDecision } from "../../domain/form-decision.js";
const SCHEMA_STATE_ID = -20260920;
const SCHEMA_PAYLOAD = JSON.stringify({ kind: "form-decision", version: 1 });
const MAX_READ_KEYS = 50;
const SOURCE_KEYS = {
    "justice.list.formaRozhodnutia": { provider: "justice", field: "formaRozhodnutia" },
    "justice.detail.formaRozhodnutia": { provider: "justice", field: "formaRozhodnutia" },
    "ustavny.item.mkFormOfDecision": { provider: "ustavny", field: "mkFormOfDecision" }
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const keyOf = (provider, id) => `${provider}:${id}`;
const normalizeValue = (value) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
function validProvider(value) {
    return value === "nsud" || value === "justice" || value === "ustavny";
}
function sourceFingerprint(rows) {
    if (rows.length === 0)
        return sha256("absent");
    const canonical = rows
        .map((row) => `${row.source_key}\u0000${row.state}\u0000${row.state === "value" && row.value !== null ? normalizeValue(row.value) : ""}`)
        .sort()
        .join("\n");
    return sha256(canonical);
}
function resolveMetadata(rows) {
    if (rows.length === 0)
        return { status: "absent", value: null, field: null };
    if (rows.some((row) => row.state === "conflict"))
        return { status: "conflict", value: null, field: null };
    const values = rows.filter((row) => row.state === "value" && row.value !== null);
    if (values.length === 0) {
        const field = [...rows].sort((a, b) => a.source_key.localeCompare(b.source_key))[0]?.field ?? null;
        return { status: "explicit_null", value: null, field };
    }
    if (values.length !== rows.length || new Set(values.map((row) => normalizeValue(row.value))).size !== 1) {
        return { status: "conflict", value: null, field: null };
    }
    const selected = [...values].sort((a, b) => a.source_key.localeCompare(b.source_key))[0];
    return { status: "value", value: selected.value, field: selected.field };
}
function schemaTablesPresent(db) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('state', 'decision_form_sources', 'decision_form_annotations')").all();
    return tables.length === 3;
}
export function isFormDecisionSchemaEntirelyAbsent(db) {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('state', 'decision_form_sources', 'decision_form_annotations')").all();
    if (!rows.some((row) => row.name === "state") || rows.some((row) => row.name === "decision_form_sources" || row.name === "decision_form_annotations"))
        return false;
    const marker = db.prepare("SELECT payload FROM state WHERE id=?").get(SCHEMA_STATE_ID);
    return marker === undefined;
}
export function hasFormDecisionSchema(db) {
    try {
        if (!schemaTablesPresent(db))
            return false;
        const sourceColumns = db.prepare("PRAGMA table_info(decision_form_sources)").all();
        const annotationColumns = db.prepare("PRAGMA table_info(decision_form_annotations)").all();
        const requiredSource = ["provider", "id", "source_key", "field", "value", "state", "fetched_at", "value_sha256"];
        const requiredAnnotation = ["provider", "id", "rule_version", "status", "source", "confidence", "reasons_json", "evidence_json", "text_sha256", "text_complete", "text_length", "source_fingerprint", "parser_version", "normalization_version", "computed_at", "run_id"];
        if (!requiredSource.every((name) => sourceColumns.some((column) => column.name === name)))
            return false;
        if (!requiredAnnotation.every((name) => annotationColumns.some((column) => column.name === name)))
            return false;
        if (["provider", "id", "source_key"].some((name, index) => sourceColumns.find((column) => column.name === name)?.pk !== index + 1))
            return false;
        if (["provider", "id", "rule_version"].some((name, index) => annotationColumns.find((column) => column.name === name)?.pk !== index + 1))
            return false;
        if (sourceColumns.filter((column) => column.pk > 0).length !== 3 || annotationColumns.filter((column) => column.pk > 0).length !== 3)
            return false;
        const state = db.prepare("SELECT payload FROM state WHERE id = ?").get(SCHEMA_STATE_ID);
        return state?.payload === SCHEMA_PAYLOAD;
    }
    catch {
        return false;
    }
}
export function initializeFormDecisionSchema(db) {
    if (hasFormDecisionSchema(db))
        return;
    const existingOptional = db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('decision_form_sources','decision_form_annotations')").get();
    const existingMarker = db.prepare("SELECT payload FROM state WHERE id=?").get(SCHEMA_STATE_ID);
    if (existingOptional.count > 0 || existingMarker)
        throw new Error("form decision schema is partial or has an incompatible marker");
    db.exec("BEGIN");
    try {
        db.exec(`CREATE TABLE decision_form_sources (
      provider TEXT NOT NULL, id TEXT NOT NULL, source_key TEXT NOT NULL, field TEXT NOT NULL,
      value TEXT, state TEXT NOT NULL CHECK(state IN ('value', 'explicit_null', 'conflict')),
      fetched_at TEXT NOT NULL, value_sha256 TEXT NOT NULL,
      PRIMARY KEY(provider, id, source_key)
    );
    CREATE TABLE decision_form_annotations (
      provider TEXT NOT NULL, id TEXT NOT NULL, rule_version TEXT NOT NULL,
      status TEXT NOT NULL, source TEXT, confidence REAL NULL, reasons_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL, text_sha256 TEXT NOT NULL, text_complete INTEGER NOT NULL,
      text_length INTEGER NOT NULL,
      source_fingerprint TEXT NOT NULL, parser_version TEXT NOT NULL, normalization_version TEXT NOT NULL,
      computed_at TEXT NOT NULL, run_id TEXT NOT NULL,
      PRIMARY KEY(provider, id, rule_version)
    );
    INSERT INTO state (id, payload) VALUES (${SCHEMA_STATE_ID}, '${SCHEMA_PAYLOAD.replaceAll("'", "''")}');`);
        db.exec("COMMIT");
    }
    catch (error) {
        try {
            db.exec("ROLLBACK");
        }
        catch { /* retain original failure */ }
        throw error;
    }
}
export function recordFormSource(db, input) {
    if (!hasFormDecisionSchema(db))
        return false;
    const allowed = SOURCE_KEYS[input.sourceKey];
    const fetchedAtMs = Date.parse(input.fetchedAt);
    if (!allowed || allowed.provider !== input.provider || allowed.field !== input.field || !input.id || Number.isNaN(fetchedAtMs))
        return false;
    const fetchedAt = new Date(fetchedAtMs).toISOString();
    const normalizedState = input.state === "conflict" ? "conflict" : input.value === null ? "explicit_null" : input.value.trim().length === 0 ? "conflict" : "value";
    const value = normalizedState === "value" ? input.value : null;
    const valueHash = sha256(`${normalizedState}\u0000${value === null ? "" : normalizeValue(value)}`);
    db.exec("BEGIN IMMEDIATE");
    try {
        const existing = db.prepare("SELECT field, value, state, fetched_at FROM decision_form_sources WHERE provider=? AND id=? AND source_key=?").get(input.provider, input.id, input.sourceKey);
        if (existing && existing.fetched_at > fetchedAt) {
            db.exec("COMMIT");
            return true;
        }
        let row = { field: input.field, value, state: normalizedState, fetchedAt, valueHash };
        if (existing && existing.fetched_at === fetchedAt && (existing.state !== normalizedState || existing.value !== value || existing.field !== input.field)) {
            row = { field: input.field, value: null, state: "conflict", fetchedAt, valueHash: sha256("conflict") };
        }
        db.prepare(`INSERT INTO decision_form_sources(provider,id,source_key,field,value,state,fetched_at,value_sha256)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider,id,source_key) DO UPDATE SET field=excluded.field,value=excluded.value,state=excluded.state,fetched_at=excluded.fetched_at,value_sha256=excluded.value_sha256`).run(input.provider, input.id, input.sourceKey, row.field, row.value, row.state, row.fetchedAt, row.valueHash);
        db.exec("COMMIT");
        return true;
    }
    catch (error) {
        try {
            db.exec("ROLLBACK");
        }
        catch { /* retain original failure */ }
        throw error;
    }
}
function sourceRows(db, provider, id) {
    return db.prepare("SELECT source_key, field, value, state, fetched_at FROM decision_form_sources WHERE provider=? AND id=? ORDER BY source_key").all(provider, id);
}
export function readFormInput(db, key, options) {
    const schemaAvailable = hasFormDecisionSchema(db);
    if (!schemaAvailable && !(options?.allowAbsentSchema === true && isFormDecisionSchemaEntirelyAbsent(db)))
        return null;
    const row = (key.provider === "nsud"
        ? db.prepare("SELECT text, text_sha256 FROM decisions WHERE id=?").get(key.id)
        : db.prepare("SELECT text, text_sha256, text_complete FROM provider_texts WHERE provider=? AND id=?").get(key.provider, key.id));
    if (!row || typeof row.text !== "string" || typeof row.text_sha256 !== "string")
        return null;
    const rows = schemaAvailable ? sourceRows(db, key.provider, key.id) : [];
    return {
        provider: key.provider, id: key.id, text: row.text, textHash: row.text_sha256,
        complete: key.provider === "nsud" ? false : row.text_complete === 1,
        metadata: resolveMetadata(rows), sourceFingerprint: sourceFingerprint(rows),
        ruleVersion: FORM_RULE_VERSION, parserVersion: FORM_PARSER_VERSION, normalizationVersion: FORM_NORMALIZATION_VERSION
    };
}
function sameInput(left, right) {
    return left.provider === right.provider && left.id === right.id && left.textHash === right.textHash && left.complete === right.complete && left.sourceFingerprint === right.sourceFingerprint && left.ruleVersion === right.ruleVersion && left.parserVersion === right.parserVersion && left.normalizationVersion === right.normalizationVersion;
}
function validEvidence(evidence, textLength) {
    return evidence.length <= 3 && evidence.every((item) => {
        if (item === null || typeof item !== "object" || Array.isArray(item))
            return false;
        if (item.kind === "source_metadata")
            return Object.keys(item).length === 3 && typeof item.field === "string" && item.field.length <= 128 && typeof item.value === "string" && item.value.length <= 2048;
        if (item.kind !== "literal_marker")
            return false;
        return Object.keys(item).length === 4 && typeof item.rule === "string" && item.rule.length <= 128 && Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.end >= item.start && item.end <= textLength;
    });
}
export function writeFormAnnotation(db, input, result, runId) {
    if (!hasFormDecisionSchema(db) || !runId || runId.length > 256 || result.ruleVersion !== input.ruleVersion || !validEvidence(result.evidence, input.text.length) || result.reasons.length > 32 || !result.reasons.every((reason) => typeof reason === "string" && reason.length <= 128))
        return false;
    db.exec("BEGIN IMMEDIATE");
    try {
        const current = readFormInput(db, { provider: input.provider, id: input.id });
        if (!current || !sameInput(current, input)) {
            db.exec("ROLLBACK");
            return false;
        }
        db.prepare(`INSERT INTO decision_form_annotations(provider,id,rule_version,status,source,confidence,reasons_json,evidence_json,text_sha256,text_complete,text_length,source_fingerprint,parser_version,normalization_version,computed_at,run_id)
      VALUES(?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,id,rule_version) DO UPDATE SET status=excluded.status,source=excluded.source,confidence=NULL,reasons_json=excluded.reasons_json,evidence_json=excluded.evidence_json,text_sha256=excluded.text_sha256,text_complete=excluded.text_complete,text_length=excluded.text_length,source_fingerprint=excluded.source_fingerprint,parser_version=excluded.parser_version,normalization_version=excluded.normalization_version,computed_at=excluded.computed_at,run_id=excluded.run_id`).run(input.provider, input.id, result.ruleVersion, result.status, result.source, JSON.stringify(result.reasons), JSON.stringify(result.evidence), input.textHash, input.complete ? 1 : 0, input.text.length, input.sourceFingerprint, input.parserVersion, input.normalizationVersion, new Date().toISOString(), runId);
        db.exec("COMMIT");
        return true;
    }
    catch (error) {
        try {
            db.exec("ROLLBACK");
        }
        catch { /* retain original failure */ }
        throw error;
    }
}
export function buildFormDecisionReadQuery(keys) {
    if (keys.length > MAX_READ_KEYS)
        throw new Error(`form decision read accepts at most ${MAX_READ_KEYS} keys`);
    if (keys.some((key) => !validProvider(key.provider) || !key.id))
        throw new Error("invalid form decision key");
    if (keys.length === 0)
        return { sql: "SELECT NULL WHERE 0", params: [] };
    const values = keys.map(() => "(?, ?)").join(", ");
    return {
        sql: `WITH requested(provider,id) AS (VALUES ${values}), ranked_sources AS (
      SELECT s.provider,s.id,s.source_key,
        CASE WHEN length(s.field) <= 128 THEN s.field ELSE '__invalid_source__' END AS field,
        CASE WHEN s.value IS NULL THEN NULL WHEN length(s.value) <= 2048 THEN s.value ELSE '__invalid_source__' END AS value,
        CASE WHEN length(s.field) > 128 OR (s.value IS NOT NULL AND length(s.value) > 2048) THEN 'conflict' ELSE s.state END AS state,
        row_number() OVER (PARTITION BY s.provider,s.id ORDER BY s.source_key) AS source_rank
      FROM decision_form_sources s JOIN requested r ON r.provider=s.provider AND r.id=s.id
    )
    SELECT r.provider,r.id,sv.payload AS schema_payload,COALESCE(d.text_sha256,pt.text_sha256) AS text_sha256,
      CASE WHEN r.provider='nsud' AND d.id IS NOT NULL THEN 0 ELSE pt.text_complete END AS text_complete,
      rs.source_key,rs.field AS source_field,rs.value AS source_value,rs.state AS source_state,
      a.status AS annotation_status,a.rule_version AS annotation_rule_version,a.source AS annotation_source,
      CASE WHEN length(a.reasons_json) <= 8192 THEN a.reasons_json ELSE NULL END AS annotation_reasons,
      CASE WHEN length(a.evidence_json) <= 8192 THEN a.evidence_json ELSE NULL END AS annotation_evidence,a.text_sha256 AS annotation_text_sha256,
      a.text_complete AS annotation_text_complete,a.text_length AS annotation_text_length,a.source_fingerprint AS annotation_source_fingerprint,
      a.parser_version AS annotation_parser_version,a.normalization_version AS annotation_normalization_version
    FROM requested r
    LEFT JOIN state sv ON sv.id=${SCHEMA_STATE_ID}
    LEFT JOIN decisions d ON r.provider='nsud' AND d.id=r.id
    LEFT JOIN provider_texts pt ON r.provider<>'nsud' AND pt.provider=r.provider AND pt.id=r.id
    LEFT JOIN decision_form_annotations a ON a.provider=r.provider AND a.id=r.id AND a.rule_version='${FORM_RULE_VERSION}'
    LEFT JOIN ranked_sources rs ON rs.provider=r.provider AND rs.id=r.id AND rs.source_rank <= 3
    ORDER BY r.provider,r.id,rs.source_key`,
        params: keys.flatMap((key) => [key.provider, key.id])
    };
}
function decodeCurrentAnnotation(row, input) {
    if (row.annotation_status === null || row.annotation_rule_version !== input.ruleVersion || row.annotation_source !== "deterministic" || row.annotation_text_sha256 !== input.textHash || row.annotation_text_complete !== (input.complete ? 1 : 0) || row.annotation_source_fingerprint !== input.sourceFingerprint || row.annotation_parser_version !== input.parserVersion || row.annotation_normalization_version !== input.normalizationVersion || row.annotation_text_length !== input.textLength || row.annotation_text_length < 0)
        return null;
    try {
        if ((row.annotation_reasons?.length ?? 0) > 8192 || (row.annotation_evidence?.length ?? 0) > 8192)
            return null;
        const reasons = JSON.parse(row.annotation_reasons ?? "");
        const evidence = JSON.parse(row.annotation_evidence ?? "");
        if (!Array.isArray(reasons) || reasons.length > 32 || !reasons.every((reason) => typeof reason === "string" && reason.length <= 128) || !Array.isArray(evidence) || !validEvidence(evidence, row.annotation_text_length))
            return null;
        if (row.annotation_status !== "detected" && row.annotation_status !== "not_detected" && row.annotation_status !== "unknown" && row.annotation_status !== "excluded")
            return null;
        return { status: row.annotation_status, ruleVersion: FORM_RULE_VERSION, source: "deterministic", reasons, evidence: evidence };
    }
    catch {
        return null;
    }
}
export function mapFormDecisionReadRows(rows) {
    const grouped = new Map();
    for (const row of rows) {
        const key = keyOf(row.provider, row.id);
        grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    const result = new Map();
    for (const [key, group] of grouped) {
        const first = group[0];
        if (first.schema_payload !== SCHEMA_PAYLOAD || first.text_sha256 === null || first.text_complete === null) {
            result.set(key, unknownFormDecision("annotation_unavailable"));
            continue;
        }
        const source = group.filter((row) => row.source_key !== null && row.source_field !== null && (row.source_state === "value" || row.source_state === "explicit_null" || row.source_state === "conflict")).map((row) => ({ source_key: row.source_key, field: row.source_field, value: row.source_value, state: row.source_state, fetched_at: "" }));
        const decision = decodeCurrentAnnotation(first, {
            textHash: first.text_sha256,
            complete: first.text_complete === 1,
            sourceFingerprint: sourceFingerprint(source),
            textLength: first.annotation_text_length ?? -1,
            ruleVersion: FORM_RULE_VERSION,
            parserVersion: FORM_PARSER_VERSION,
            normalizationVersion: FORM_NORMALIZATION_VERSION
        });
        result.set(key, decision ?? unknownFormDecision(first.annotation_status === null ? "missing_annotation" : "stale_input"));
    }
    return result;
}
/** Returns only a schema-validated annotation matching the supplied current input. */
export function readCurrentFormDecision(db, input) {
    if (!hasFormDecisionSchema(db))
        return null;
    const row = db.prepare(`SELECT status AS annotation_status,rule_version AS annotation_rule_version,source AS annotation_source,
    reasons_json AS annotation_reasons,evidence_json AS annotation_evidence,text_sha256 AS annotation_text_sha256,
    text_complete AS annotation_text_complete,text_length AS annotation_text_length,source_fingerprint AS annotation_source_fingerprint,
    parser_version AS annotation_parser_version,normalization_version AS annotation_normalization_version
    FROM decision_form_annotations WHERE provider=? AND id=? AND rule_version=?`).get(input.provider, input.id, input.ruleVersion);
    return row ? decodeCurrentAnnotation(row, { textHash: input.textHash, complete: input.complete, sourceFingerprint: input.sourceFingerprint, textLength: input.text.length, ruleVersion: input.ruleVersion, parserVersion: input.parserVersion, normalizationVersion: input.normalizationVersion }) : null;
}
//# sourceMappingURL=form-decision-store.js.map