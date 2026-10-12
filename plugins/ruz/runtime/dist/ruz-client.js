const ID_PAGE_SIZE = 100;
const MAX_ID_PAGES = 10;
/**
 * RÚZ serves its outage page as HTML with **HTTP 200**, so res.ok says nothing.
 * Feeding that to JSON.parse surfaced `Unexpected token '<', "<!DOCTYPE "...`,
 * which reads like a bug in this server rather than a register that is down.
 */
export class RuzUnavailableError extends Error {
    constructor(path, expected = "JSON") {
        super(`Register účtovných závierok je momentálne nedostupný (${path}). ` +
            `Zdroj vrátil HTML stránku namiesto ${expected}. Skús to neskôr.`);
        this.name = "RuzUnavailableError";
    }
}
/** Parse a RÚZ response body, telling an outage page apart from real JSON. */
export function parseRuzJson(body, path, contentType) {
    const trimmed = body.trimStart();
    const looksHtml = trimmed.startsWith("<") || (contentType ?? "").toLowerCase().includes("text/html");
    if (looksHtml) {
        throw new RuzUnavailableError(path);
    }
    try {
        return JSON.parse(body);
    }
    catch {
        throw new Error(`RÚZ API ${path} vrátilo odpoveď, ktorá nie je platný JSON.`);
    }
}
const DEFAULT_BASE = "https://www.registeruz.sk/cruz-public/api";
const DEFAULT_WEB_BASE = "https://www.registeruz.sk/cruz-public";
export class RuzClient {
    base;
    webBase;
    fetchImpl;
    timeoutMs;
    templateCache = new Map();
    codelistCache = new Map();
    constructor(opts = {}) {
        this.base = opts.baseUrl ?? DEFAULT_BASE;
        this.webBase = opts.webBaseUrl ?? DEFAULT_WEB_BASE;
        this.fetchImpl = opts.fetchImpl ?? fetch;
        this.timeoutMs = opts.timeoutMs ?? 30000;
    }
    async getJson(path) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
        try {
            const res = await this.fetchImpl(`${this.base}${path}`, { signal: ctrl.signal });
            if (!res.ok) {
                throw new Error(`RÚZ API ${path} failed: HTTP ${res.status}`);
            }
            const body = await res.text();
            return parseRuzJson(body, path, res.headers?.get?.("content-type") ?? null);
        }
        finally {
            clearTimeout(t);
        }
    }
    findEntityIdsByIco(ico) {
        return this.findEntityIds(`ico=${encodeURIComponent(ico)}`);
    }
    findEntityIdsByDic(dic) {
        return this.findEntityIds(`dic=${encodeURIComponent(dic)}`);
    }
    /**
     * Every id for an IČO/DIČ filter. The list is paged by id; `existujeDalsieId`
     * says another page follows (continue after the last id received). Ignoring
     * it silently truncated the list at the page size.
     */
    async findEntityIds(filter) {
        const ids = [];
        let after = 0;
        for (let page = 0; page < MAX_ID_PAGES; page++) {
            const r = await this.getJson(`/uctovne-jednotky?${filter}&zmenene-od=2000-01-01&pokracovat-za-id=${after}&max-zaznamov=${ID_PAGE_SIZE}`);
            const batch = r.id ?? [];
            ids.push(...batch);
            if (!r.existujeDalsieId || batch.length === 0)
                return ids;
            after = batch[batch.length - 1];
        }
        throw new Error(`RÚZ API vrátilo pre ${filter} viac ako ${MAX_ID_PAGES * ID_PAGE_SIZE} účtovných jednotiek; zoznam je neúplný.`);
    }
    /** Codelist (`velkosti-organizacie`, `pravne-formy`), fetched once per client. */
    async getCodelist(name) {
        const cached = this.codelistCache.get(name);
        if (cached)
            return cached;
        const c = await this.getJson(`/${name}`);
        this.codelistCache.set(name, c);
        return c;
    }
    getEntity(id) {
        return this.getJson(`/uctovna-jednotka?id=${id}`);
    }
    getStatement(id) {
        return this.getJson(`/uctovna-zavierka?id=${id}`);
    }
    getReport(id) {
        return this.getJson(`/uctovny-vykaz?id=${id}`);
    }
    getAnnualReport(id) {
        return this.getJson(`/vyrocna-sprava?id=${id}`);
    }
    async getTemplate(id) {
        const cached = this.templateCache.get(id);
        if (cached)
            return cached;
        const t = await this.getJson(`/sablona?id=${id}`);
        this.templateCache.set(id, t);
        return t;
    }
    /**
     * Download an attachment's bytes. Returns base64 and content-type.
     *
     * Attachments are served outside the /api prefix, via the web-app path:
     *   GET /cruz-public/domain/financialreport/attachment/{id}
     * (documented at https://www.registeruz.sk/cruz-public/home/api)
     */
    async downloadAttachment(id) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
        try {
            const url = `${this.webBase}/domain/financialreport/attachment/${id}`;
            const res = await this.fetchImpl(url, { signal: ctrl.signal });
            if (!res.ok)
                throw new Error(`RÚZ príloha ${id} failed: HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            const contentType = res.headers.get("content-type") ?? "application/octet-stream";
            // The outage page comes with HTTP 200 here too; saving it as "zavierka.pdf"
            // would hand the caller an HTML file under a PDF name.
            if (contentType.toLowerCase().includes("text/html") || buf.subarray(0, 64).toString("latin1").trimStart().startsWith("<")) {
                throw new RuzUnavailableError(`/domain/financialreport/attachment/${id}`, "prílohy");
            }
            return { base64: buf.toString("base64"), contentType };
        }
        finally {
            clearTimeout(t);
        }
    }
}
