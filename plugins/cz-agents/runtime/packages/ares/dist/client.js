import { HttpClient, TtlCache } from '@czagents/shared';
/**
 * Typed client for ARES REST v3 API.
 * Docs: https://ares.gov.cz/stranky/vyvojar-info
 * OpenAPI: https://ares.gov.cz/swagger-ui/
 */
const ARES_BASE = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';
const ARES_VR_BASE = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty-vr';
export class AresClient {
    http;
    // ARES company data changes rarely — cache lookups 1 hour to ease upstream load
    subjectCache = new TtlCache({
        ttlMs: 60 * 60 * 1000, // 1 hour
        maxSize: 5000,
    });
    bankCache = new TtlCache({
        ttlMs: 60 * 60 * 1000,
        maxSize: 2000,
    });
    vrCache = new TtlCache({
        ttlMs: 60 * 60 * 1000, // 1 hour
        maxSize: 5000,
    });
    historyCache = new TtlCache({
        ttlMs: 24 * 60 * 60 * 1000, // 24 hours — history is immutable
        maxSize: 2000,
    });
    constructor() {
        this.http = new HttpClient({
            baseUrl: ARES_BASE,
            timeoutMs: 12_000,
            retries: 2,
        });
    }
    /** Get single economic subject by IČO. 404 → null (not an error). Cached 1h. */
    async getByIco(ico) {
        return this.subjectCache.memoize(ico, async () => {
            try {
                return await this.http.getJson(`/${ico}`);
            }
            catch (e) {
                if (e?.status === 404)
                    return null;
                throw e;
            }
        });
    }
    /** Full-text search. ARES v3 accepts POST with `obchodniJmeno`, `sidlo.*`, etc. */
    async search(params) {
        const body = {};
        if (params.ico?.length)
            body.ico = params.ico;
        if (params.obchodniJmeno)
            body.obchodniJmeno = params.obchodniJmeno;
        if (params.pravniForma?.length)
            body.pravniForma = params.pravniForma;
        if (params.sidlo)
            body.sidlo = params.sidlo;
        if (params.czNace?.length)
            body.czNace = params.czNace;
        if (params.query && !body.obchodniJmeno)
            body.obchodniJmeno = params.query;
        body.start = params.start ?? 0;
        body.pocet = Math.min(params.pocet ?? 10, 100);
        return await this.http.getJson('/vyhledat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }
    /**
     * Get transparent bank accounts published for this IČO (DPH registered subjects).
     * ARES wraps the ADIS registry here.
     */
    async getBankAccounts(ico) {
        return this.bankCache.memoize(ico, async () => {
            try {
                const data = await this.http.getJson(`/ekonomicky-subjekt-cuds/${ico}`);
                return data.uctyCslib ?? [];
            }
            catch (e) {
                if (e?.status === 404)
                    return [];
                throw e;
            }
        });
    }
    /** Historical records for subject (previous names, sídlo changes). */
    async getHistory(ico) {
        return this.historyCache.memoize(ico, async () => {
            try {
                return await this.http.getJson(`/${ico}/historie`);
            }
            catch (e) {
                if (e?.status === 404)
                    return null;
                throw e;
            }
        });
    }
    /**
     * Get Veřejný rejstřík record (active only, currently-valid statutory bodies).
     * Filters out historical entries (datumVymazu != null) by default.
     */
    async getVrRecord(ico) {
        return this.vrCache.memoize(ico, async () => {
            try {
                // VR is sibling endpoint, use absolute URL to escape base path
                const data = await this.http.getJson(`${ARES_VR_BASE}/${ico}`);
                // Prefer AKTIVNI record — companies with historical entries (e.g. former
                // branch offices, Generali Česká pojišťovna IČO 45272956) have a HISTORICKY
                // record at index 0 with empty statutarniOrgany; real data is in AKTIVNI.
                const zaznamy = data.zaznamy ?? [];
                return zaznamy.find((r) => r.stavSubjektu === 'AKTIVNI') ?? zaznamy[0] ?? null;
            }
            catch (e) {
                if (e?.status === 404)
                    return null;
                throw e;
            }
        });
    }
}
//# sourceMappingURL=client.js.map