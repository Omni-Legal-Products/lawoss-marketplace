const API_BASE = 'https://api.statistics.sk';
export class SkOrsrAdapter {
    fetchImpl;
    constructor(fetchImpl = globalThis.fetch) {
        this.fetchImpl = fetchImpl;
    }
    async searchByName(name, limit = 10) {
        const url = new URL('/rpo/v1/search', API_BASE);
        url.searchParams.set('fullName', name);
        url.searchParams.set('page', '0');
        url.searchParams.set('size', String(limit));
        try {
            const response = await this.fetchImpl(url, { headers: { Accept: 'application/json' } });
            if (!response.ok) {
                warn(`RPO search failed: ${response.status} ${response.statusText}`);
                return { companies: [], total_results: 0 };
            }
            const payload = (await response.json());
            const companies = (payload.results ?? [])
                .map(mapEntity)
                .filter((company) => company !== null);
            return { companies, total_results: companies.length };
        }
        catch (error) {
            warn('RPO search failed', error);
            return { companies: [], total_results: 0 };
        }
    }
    async getById(id) {
        const url = new URL('/rpo/v1/search', API_BASE);
        url.searchParams.set('identifier', id);
        url.searchParams.set('page', '0');
        url.searchParams.set('size', '1');
        try {
            const response = await this.fetchImpl(url, { headers: { Accept: 'application/json' } });
            if (!response.ok) {
                warn(`RPO lookup failed: ${response.status} ${response.statusText}`);
                return null;
            }
            const payload = (await response.json());
            const entity = payload.results?.[0];
            return entity ? mapEntity(entity) : null;
        }
        catch (error) {
            warn('RPO lookup failed', error);
            return null;
        }
    }
}
function mapEntity(entity) {
    const ico = entity.identifiers?.[0]?.value;
    // Active name = entry with no validTo; fall back to last entry
    const activeName = entity.fullNames?.find((n) => !n.validTo) ?? entity.fullNames?.[entity.fullNames.length - 1];
    const name = activeName?.value;
    if (!ico || !name)
        return null;
    // Active address = entry with no validTo
    const addr = entity.addresses?.find((a) => !a.validTo) ?? entity.addresses?.[0];
    return {
        id: ico,
        country: 'sk',
        name,
        status: entity.terminationDate ? 'dissolved' : 'active',
        address: formatAddress(addr),
        registered_on: entity.establishment,
        source_url: `https://rpo.statistics.sk/rpo/registration/${entity.id ?? ''}`,
    };
}
function formatAddress(addr) {
    if (!addr)
        return undefined;
    const parts = [
        addr.street,
        addr.buildingNumber,
        addr.postalCodes?.[0],
        addr.municipality?.value,
    ].filter((p) => Boolean(p));
    return parts.length > 0 ? parts.join(', ') : undefined;
}
function warn(message, error) {
    if (error === undefined)
        console.warn(`[cz-agents/eu-registry] ${message}`);
    else
        console.warn(`[cz-agents/eu-registry] ${message}:`, error);
}
//# sourceMappingURL=sk-orsr.js.map