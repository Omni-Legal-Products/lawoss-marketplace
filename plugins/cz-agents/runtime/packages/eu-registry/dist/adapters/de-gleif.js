import { SEARCH_TTL_MS } from '../gleif-cache.js';
// GLEIF (Global Legal Entity Identifier Foundation) — free, no auth, ISO 17442.
// Covers companies with LEIs (mid-large entities). Small firms without LEIs won't appear.
// Rate limit: 60 req/min. Supports any jurisdiction via filter[entity.jurisdiction].
const API_BASE = 'https://api.gleif.org/api/v1';
const REQUEST_TIMEOUT_MS = 10_000;
/** Generic GLEIF adapter — pass an ISO 3166-1 alpha-2 jurisdiction (e.g. 'DE', 'NL'). */
export class GleifAdapter {
    jurisdiction;
    fetchImpl;
    cache;
    countryCode;
    constructor(jurisdiction, fetchImpl = globalThis.fetch, cache) {
        this.jurisdiction = jurisdiction;
        this.fetchImpl = fetchImpl;
        this.cache = cache;
        this.countryCode = jurisdiction.toLowerCase();
    }
    async searchByName(name, limit = 10) {
        const cacheKey = `search:${this.jurisdiction}:${name}:${limit}`;
        if (this.cache) {
            const cached = this.cache.get(cacheKey);
            if (cached !== null)
                return cached;
        }
        const url = new URL(`${API_BASE}/lei-records`);
        url.searchParams.set('filter[fulltext]', name);
        url.searchParams.set('filter[entity.jurisdiction]', this.jurisdiction.toUpperCase());
        url.searchParams.set('page[size]', String(limit));
        try {
            const response = await this.fetchImpl(url, requestInit());
            if (!response.ok) {
                warn(`GLEIF search failed: ${response.status} ${response.statusText}`);
                return { companies: [], total_results: 0 };
            }
            const payload = (await response.json());
            const cc = this.countryCode;
            const companies = (payload.data ?? [])
                .map((r) => mapRecord(r, cc))
                .filter((c) => c !== null);
            const result = {
                companies,
                total_results: payload.meta?.pagination?.total ?? companies.length,
            };
            this.cache?.set(cacheKey, result, SEARCH_TTL_MS);
            return result;
        }
        catch (error) {
            warn('GLEIF search failed', error);
            return { companies: [], total_results: 0 };
        }
    }
    async getById(id) {
        const cacheKey = `lei:${id}`;
        if (this.cache) {
            const cached = this.cache.get(cacheKey);
            if (cached !== null)
                return cached;
        }
        const url = new URL(`${API_BASE}/lei-records/${encodeURIComponent(id)}`);
        try {
            const response = await this.fetchImpl(url, requestInit());
            if (response.status === 404)
                return null;
            if (!response.ok) {
                warn(`GLEIF lookup failed: ${response.status} ${response.statusText}`);
                return null;
            }
            const payload = (await response.json());
            const company = payload.data ? mapRecord(payload.data, this.countryCode) : null;
            // Don't cache null — company not found yet may be added later.
            if (company !== null)
                this.cache?.set(cacheKey, company);
            return company;
        }
        catch (error) {
            warn('GLEIF lookup failed', error);
            return null;
        }
    }
}
/** Backward-compat alias for DE. */
export class DeGleifAdapter extends GleifAdapter {
    constructor(fetchImpl = globalThis.fetch, cache) {
        super('DE', fetchImpl, cache);
    }
}
function mapRecord(record, countryCode) {
    const lei = record.id;
    const entity = record.attributes?.entity;
    const name = entity?.legalName?.name;
    if (!lei || !name)
        return null;
    return {
        id: lei,
        country: countryCode,
        name,
        status: mapStatus(entity?.status),
        address: formatAddress(entity?.legalAddress),
        registered_on: entity?.creationDate?.slice(0, 10),
        lei,
        source_url: `https://search.gleif.org/#/record/${lei}`,
    };
}
function mapStatus(status) {
    const s = status?.toUpperCase();
    if (s === 'ACTIVE')
        return 'active';
    if (s === 'INACTIVE')
        return 'dissolved';
    return 'unknown';
}
function formatAddress(addr) {
    if (!addr)
        return undefined;
    const parts = [
        ...(addr.addressLines ?? []),
        addr.postalCode,
        addr.city,
    ].filter((p) => Boolean(p));
    return parts.length > 0 ? parts.join(', ') : undefined;
}
function requestInit() {
    return {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Accept: 'application/vnd.api+json' },
    };
}
function warn(message, error) {
    if (error === undefined)
        console.warn(`[cz-agents/eu-registry] ${message}`);
    else
        console.warn(`[cz-agents/eu-registry] ${message}:`, error);
}
//# sourceMappingURL=de-gleif.js.map