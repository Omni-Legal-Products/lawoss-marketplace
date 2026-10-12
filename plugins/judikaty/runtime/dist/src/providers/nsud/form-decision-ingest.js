import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { getIndexDatabasePath } from "./law-index-store.js";
import { hasFormDecisionSchema, recordFormSource } from "./form-decision-store.js";
function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function normalize(value) {
    return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
}
export function classifyUstavnyRawForm(value) {
    if (value === null)
        return { value: null };
    if (typeof value === "string")
        return { value };
    if (!Array.isArray(value))
        return { value: null, state: "conflict" };
    if (value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
        return { value: null, state: "conflict" };
    }
    const strings = value;
    if (new Set(strings.map(normalize)).size !== 1)
        return { value: null, state: "conflict" };
    return { value: strings[0] };
}
/** Opens an existing optional store once for a response batch. Failures are best effort. */
export function recordFormDecisionSources(inputs) {
    if (inputs.length === 0)
        return false;
    const dbPath = inputs[0]?.dbPath ?? getIndexDatabasePath();
    if (!existsSync(dbPath))
        return false;
    let db = null;
    try {
        db = new DatabaseSync(dbPath);
        if (!hasFormDecisionSchema(db))
            return false;
        let recorded = false;
        for (const input of inputs) {
            if ((input.dbPath ?? dbPath) !== dbPath)
                continue;
            recorded = (input.state === "conflict"
                ? recordFormSource(db, { ...input, state: "conflict" })
                : recordFormSource(db, {
                    provider: input.provider,
                    id: input.id,
                    sourceKey: input.sourceKey,
                    field: input.field,
                    value: input.value,
                    fetchedAt: input.fetchedAt
                })) || recorded;
        }
        return recorded;
    }
    catch {
        return false;
    }
    finally {
        try {
            db?.close();
        }
        catch { /* source persistence must not affect the reply path */ }
    }
}
/** Preserves the single-record facade used by offline job tests. */
export function recordFormDecisionSource(input) {
    return recordFormDecisionSources([input]);
}
function justiceRaw(value, sourceKey, id, fetchedAt) {
    if (value !== null && typeof value !== "string")
        return null;
    return {
        provider: "justice",
        id,
        sourceKey,
        field: "formaRozhodnutia",
        value,
        fetchedAt
    };
}
export function recordJusticeListFormSources(response, fetchedAt) {
    if (!isObject(response) || !Array.isArray(response.rozhodnutieList))
        return;
    const inputs = [];
    for (const item of response.rozhodnutieList) {
        if (!isObject(item) || typeof item.guid !== "string" || !hasOwn(item, "formaRozhodnutia"))
            continue;
        const input = justiceRaw(item.formaRozhodnutia, "justice.list.formaRozhodnutia", item.guid, fetchedAt);
        if (input)
            inputs.push(input);
    }
    recordFormDecisionSources(inputs);
}
export function recordJusticeDetailFormSource(response, fallbackId, fetchedAt) {
    if (!isObject(response) || !hasOwn(response, "formaRozhodnutia"))
        return;
    const id = typeof response.guid === "string" ? response.guid : fallbackId;
    const input = justiceRaw(response.formaRozhodnutia, "justice.detail.formaRozhodnutia", id, fetchedAt);
    if (input)
        recordFormDecisionSources([input]);
}
function ustavnyRaw(value, id, fetchedAt) {
    const classified = classifyUstavnyRawForm(value);
    if (classified === null)
        return null;
    return {
        provider: "ustavny",
        id,
        sourceKey: "ustavny.item.mkFormOfDecision",
        field: "mkFormOfDecision",
        value: classified.value,
        state: classified.state,
        fetchedAt
    };
}
export function recordUstavnySearchFormSources(response, fetchedAt) {
    if (!isObject(response) || !Array.isArray(response.documents))
        return;
    const inputs = [];
    for (const item of response.documents) {
        if (!isObject(item) || typeof item.documentId !== "string" || !hasOwn(item, "mkFormOfDecision"))
            continue;
        const input = ustavnyRaw(item.mkFormOfDecision, item.documentId, fetchedAt);
        if (input)
            inputs.push(input);
    }
    recordFormDecisionSources(inputs);
}
export function recordUstavnyDetailFormSource(response, fallbackId, fetchedAt) {
    if (!isObject(response) || !hasOwn(response, "mkFormOfDecision"))
        return;
    const id = typeof response.documentId === "string" ? response.documentId : fallbackId;
    const input = ustavnyRaw(response.mkFormOfDecision, id, fetchedAt);
    if (input)
        recordFormDecisionSources([input]);
}
//# sourceMappingURL=form-decision-ingest.js.map