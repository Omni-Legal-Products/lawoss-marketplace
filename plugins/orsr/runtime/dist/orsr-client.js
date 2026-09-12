import { sanitizeUrlForLogs } from "./redaction.js";
export { sanitizeUrlForLogs } from "./redaction.js";
const ORSR_BASE_URL = "https://sluzby.orsr.sk";
const ORSR_DEBUG_LOGS = isTruthy(process.env.ORSR_DEBUG_LOGS);
/**
 * Carries WHY a request failed. Every failure used to reach the caller as the
 * same "Upstream ORSR request failed.", so a timeout, a rejected parameter and
 * a server fault were indistinguishable and the caller could not tell whether
 * retrying would help.
 */
export class OrsrRequestError extends Error {
    kind;
    status;
    constructor(kind, message, status) {
        super(message);
        this.name = "OrsrRequestError";
        this.kind = kind;
        this.status = status;
    }
}
function envInt(name, fallback) {
    const raw = process.env[name]?.trim();
    if (!raw)
        return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
export class OrsrClient {
    requestOptions;
    constructor(options = {}) {
        this.requestOptions = {
            // sluzby.orsr.sk is slow: /api/legal-person/extract was measured at ~9 s
            // and /lookup/Autocomplete-* at ~18 s. The old 12 s ceiling turned that
            // latency into aborts, so detail calls failed while search still worked.
            timeoutMs: options.timeoutMs ?? envInt("ORSR_TIMEOUT_MS", 25_000),
            maxRetries: options.maxRetries ?? 2,
            retryBaseDelayMs: options.retryBaseDelayMs ?? 400,
            // A slow upstream must not be multiplied by retries into a minutes-long
            // call — attempts stop once the budget is spent.
            deadlineMs: options.deadlineMs ?? envInt("ORSR_DEADLINE_MS", 40_000),
        };
    }
    async searchLegalPersons(input) {
        validateSearchInput(input);
        const params = new URLSearchParams();
        params.set("Skip", String(input.skip ?? 0));
        params.set("Take", String(input.take ?? 20));
        params.set("sortCriteria[0].Direction", input.sortDirection ?? "Ascending");
        params.set("sortCriteria[0].FieldName", input.sortFieldName ?? "CorporateBodyFullName");
        const filters = input.filters ?? {};
        setIfDefined(params, "Filter.CorporateBodyFullNameOrRegistrationNumber", filters.corporateBodyFullNameOrRegistrationNumber);
        setIfDefined(params, "Filter.CorporateBodyNameLike", filters.corporateBodyNameLike);
        setIfDefined(params, "Filter.Court", filters.court);
        setIfDefined(params, "Filter.FileReferenceCourt", filters.fileReferenceCourt);
        setIfDefined(params, "Filter.FileReferenceSection", filters.fileReferenceSection);
        setIfDefined(params, "Filter.FileReferenceInsertNumber", filters.fileReferenceInsertNumber);
        setIfDefined(params, "Filter.IncludeTerminated", filters.includeTerminated);
        setIfDefined(params, "Filter.LegalForm", filters.legalForm);
        setIfDefined(params, "Filter.PhysicalPersonName", filters.physicalPersonName);
        setIfDefined(params, "Filter.PhysicalPersonType", filters.physicalPersonType);
        setIfDefined(params, "Filter.AddressStreet", filters.addressStreet);
        setIfDefined(params, "Filter.AddressNumber", filters.addressNumber);
        setIfDefined(params, "Filter.AddressMunicipality", filters.addressMunicipality);
        return this.requestJson("/api/legal-person", params);
    }
    async getExtract(input) {
        return this.requestJson("/api/legal-person/extract", fileRefParams(input));
    }
    async getExtractFull(input) {
        return this.requestJson("/api/legal-person/extract-full", fileRefParams(input));
    }
    async getDocuments(input) {
        return this.requestJson("/api/legal-person/documents", fileRefParams(input));
    }
    async getRelated(input) {
        return this.requestJson("/api/legal-person/related", fileRefParams(input));
    }
    async lookupOrsrLegalPersons(input) {
        return this.requestJson("/lookup/Autocomplete-ORSR-LegalPersons", lookupParams(input));
    }
    async lookupOrsrLegalPersonsComplete(input) {
        return this.requestJson("/lookup/Autocomplete-ORSR-LegalPersonsComplete", lookupParams(input));
    }
    async lookupLegalPersons(input) {
        return this.requestJson("/lookup/Autocomplete-LegalPersons", lookupParams(input));
    }
    async lookupAddress(input) {
        return this.requestJson("/lookup/Autocomplete-Address", lookupParams(input));
    }
    async checkLegalPerson(query) {
        const params = new URLSearchParams({ query });
        return this.requestJson("/lookup/check-legal-person", params, { retry500: false });
    }
    async getCodelist(codelistCode) {
        const safeCode = codelistCode.trim().replace(/^\/+/, "");
        if (!/^[A-Za-z0-9_-]+$/.test(safeCode)) {
            throw new OrsrInputError("Neplatný kód číselníka ORSR.");
        }
        return this.requestJson(`/codelist/${encodeURIComponent(safeCode)}`);
    }
    async requestJson(path, params, opts) {
        const url = new URL(path, ORSR_BASE_URL);
        if (params) {
            url.search = params.toString();
        }
        const { timeoutMs, maxRetries, retryBaseDelayMs, deadlineMs } = this.requestOptions;
        const retry500 = opts?.retry500 ?? true;
        const deadlineAt = Date.now() + deadlineMs;
        /** Never let one attempt run past the overall budget. */
        const attemptTimeout = () => Math.max(1, Math.min(timeoutMs, deadlineAt - Date.now()));
        const budgetLeft = () => deadlineAt - Date.now() > 0;
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            const controller = new AbortController();
            const perAttemptTimeoutMs = attemptTimeout();
            const timer = setTimeout(() => controller.abort(), perAttemptTimeoutMs);
            const startedAt = Date.now();
            const attemptNumber = attempt + 1;
            logOrsrEvent("request_start", {
                method: "GET",
                url: sanitizeUrlForLogs(url),
                path,
                attempt: attemptNumber,
                maxAttempts: maxRetries + 1,
                timeoutMs: perAttemptTimeoutMs,
            });
            try {
                const response = await fetch(url, {
                    method: "GET",
                    headers: {
                        Accept: "application/json",
                        "User-Agent": "orsr-mcp/0.1",
                    },
                    signal: controller.signal,
                });
                if (response.ok) {
                    logOrsrEvent("request_success", {
                        method: "GET",
                        url: sanitizeUrlForLogs(url),
                        path,
                        attempt: attemptNumber,
                        maxAttempts: maxRetries + 1,
                        status: response.status,
                        statusText: response.statusText,
                        durationMs: Date.now() - startedAt,
                    });
                    const body = await response.text();
                    // Výpadkové stránky chodia ako HTML so stavom 200, takže response.ok
                    // o ničom nesvedčí a JSON.parse by vyhodil "Unexpected token '<'" —
                    // to vyzerá ako chyba tohto servera, nie ako nedostupný register.
                    const contentType = response.headers?.get?.("content-type") ?? "";
                    if (body.trimStart().startsWith("<") || contentType.toLowerCase().includes("text/html")) {
                        throw new OrsrRequestError("network", "ORSR vrátilo HTML namiesto JSON — zdroj je pravdepodobne nedostupný.");
                    }
                    try {
                        return JSON.parse(body);
                    }
                    catch {
                        throw new OrsrRequestError("malformed", "ORSR returned malformed JSON.");
                    }
                }
                const retriableStatus = response.status === 408 || response.status === 429 || (retry500 && response.status >= 500);
                logOrsrEvent("request_http_error", {
                    method: "GET",
                    url: sanitizeUrlForLogs(url),
                    path,
                    attempt: attemptNumber,
                    maxAttempts: maxRetries + 1,
                    status: response.status,
                    statusText: response.statusText,
                    durationMs: Date.now() - startedAt,
                    retriable: retriableStatus && attempt < maxRetries,
                    bodyPreview: "[REDACTED]",
                });
                if (attempt < maxRetries && retriableStatus && budgetLeft()) {
                    await sleep(retryBaseDelayMs * 2 ** attempt);
                    continue;
                }
                throw new OrsrRequestError("upstream_status", `ORSR request failed (${response.status}) ${response.statusText}`, response.status);
            }
            catch (error) {
                if (error instanceof OrsrRequestError)
                    throw error;
                const isAbort = (error instanceof DOMException && error.name === "AbortError") ||
                    (error instanceof Error && error.name === "AbortError");
                const isNetwork = error instanceof TypeError;
                const canRetry = attempt < maxRetries && (isAbort || isNetwork) && budgetLeft();
                logOrsrEvent("request_exception", {
                    method: "GET",
                    url: sanitizeUrlForLogs(url),
                    path,
                    attempt: attemptNumber,
                    maxAttempts: maxRetries + 1,
                    durationMs: Date.now() - startedAt,
                    retriable: canRetry,
                    errorType: isAbort ? "timeout" : isNetwork ? "network" : "unknown",
                    errorMessage: isAbort
                        ? "ORSR request timed out."
                        : isNetwork
                            ? "ORSR network request failed."
                            : "ORSR request failed.",
                });
                if (canRetry) {
                    await sleep(retryBaseDelayMs * 2 ** attempt);
                    continue;
                }
                if (isAbort) {
                    throw new OrsrRequestError("timeout", "ORSR request timed out.");
                }
                if (isNetwork) {
                    throw new OrsrRequestError("network", "ORSR network request failed.");
                }
                throw new OrsrRequestError("unknown", "ORSR request failed.");
            }
            finally {
                clearTimeout(timer);
            }
        }
        throw new OrsrRequestError("timeout", "ORSR request retry loop exhausted");
    }
}
/** Thrown before any network call, when the arguments cannot form a valid query. */
export class OrsrInputError extends Error {
    constructor(message) {
        super(message);
        this.name = "OrsrInputError";
    }
}
function validateSearchInput(input) {
    const filters = input.filters ?? {};
    const hasCoreCriterion = Boolean(normalizeString(filters.corporateBodyFullNameOrRegistrationNumber) ||
        normalizeString(filters.physicalPersonName) ||
        normalizeString(filters.addressStreet) ||
        normalizeString(filters.addressMunicipality) ||
        (normalizeString(filters.fileReferenceCourt) && normalizeString(filters.fileReferenceSection) && filters.fileReferenceInsertNumber !== undefined));
    if (!hasCoreCriterion) {
        throw new OrsrInputError("ORSR search vyzaduje aspon jedno jadrove kriterium: corporateBodyFullNameOrRegistrationNumber, physicalPersonName, addressStreet/addressMunicipality, alebo kompletna spisova znacka (fileReferenceCourt+fileReferenceSection+fileReferenceInsertNumber). " +
            "corporateBodyNameLike, court a legalForm su iba modifikatory - samy o sebe vyhladavanie nespustia.");
    }
}
function fileRefParams(input) {
    return new URLSearchParams({
        oddiel: String(input.oddiel),
        vlozka: String(input.vlozka),
        sud: String(input.sud),
    });
}
function lookupParams(input) {
    return new URLSearchParams({
        query: input.query,
        draw: String(input.draw ?? 1),
    });
}
function setIfDefined(params, key, value) {
    if (value === undefined || value === null) {
        return;
    }
    const asString = String(value).trim();
    if (asString.length > 0) {
        params.set(key, asString);
    }
}
function normalizeString(value) {
    if (typeof value !== "string") {
        return "";
    }
    return value.trim();
}
function singleLine(text) {
    return text.replace(/\s+/g, " ").trim();
}
function logOrsrEvent(event, payload) {
    if (!ORSR_DEBUG_LOGS) {
        return;
    }
    const line = {
        ts: new Date().toISOString(),
        component: "orsr-client",
        event,
        ...payload,
    };
    // Single-line JSON keeps Dokploy logs searchable and parseable.
    console.log(JSON.stringify(line));
}
function isTruthy(value) {
    return /^(1|true|yes|on)$/i.test(value ?? "");
}
function truncate(text, maxLength) {
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength)}...`;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
