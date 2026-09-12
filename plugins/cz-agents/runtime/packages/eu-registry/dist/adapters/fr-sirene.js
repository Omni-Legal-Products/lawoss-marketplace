const API_BASE = 'https://recherche-entreprises.api.gouv.fr';
const REQUEST_TIMEOUT_MS = 10_000;
export class FrSireneAdapter {
    fetchImpl;
    constructor(fetchImpl = globalThis.fetch) {
        this.fetchImpl = fetchImpl;
    }
    async searchByName(name, limit = 10) {
        const url = new URL('/search', API_BASE);
        url.searchParams.set('q', name);
        url.searchParams.set('per_page', String(limit));
        try {
            const response = await this.fetchImpl(url, requestInit());
            if (!response.ok) {
                warn(`SIRENE search failed: ${response.status} ${response.statusText}`);
                return { companies: [], total_results: 0 };
            }
            const payload = (await response.json());
            const companies = (payload.results ?? [])
                .map(mapResult)
                .filter((c) => c !== null);
            return {
                companies,
                total_results: payload.total_results ?? companies.length,
            };
        }
        catch (error) {
            warn('SIRENE search failed', error);
            return { companies: [], total_results: 0 };
        }
    }
    async getById(id) {
        const url = new URL('/search', API_BASE);
        url.searchParams.set('q', id);
        url.searchParams.set('per_page', '1');
        try {
            const response = await this.fetchImpl(url, requestInit());
            if (!response.ok) {
                warn(`SIRENE lookup failed: ${response.status} ${response.statusText}`);
                return null;
            }
            const payload = (await response.json());
            const result = payload.results?.[0];
            return result ? mapResult(result) : null;
        }
        catch (error) {
            warn('SIRENE lookup failed', error);
            return null;
        }
    }
}
function mapResult(r) {
    if (!r.siren)
        return null;
    const name = r.nom_complet ?? r.nom_raison_sociale;
    if (!name)
        return null;
    return {
        id: r.siren,
        country: 'fr',
        name,
        status: mapStatus(r.etat_administratif),
        address: r.siege?.adresse ?? formatSiegeAddress(r.siege),
        registered_on: r.date_creation,
        source_url: `https://annuaire-entreprises.data.gouv.fr/entreprise/${r.siren}`,
    };
}
function mapStatus(etat) {
    if (etat === 'A')
        return 'active';
    if (etat === 'C')
        return 'dissolved';
    return 'unknown';
}
function formatSiegeAddress(siege) {
    if (!siege)
        return undefined;
    const parts = [siege.code_postal, siege.libelle_commune].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : undefined;
}
function requestInit() {
    return { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
}
function warn(message, error) {
    if (error === undefined)
        console.warn(`[cz-agents/eu-registry] ${message}`);
    else
        console.warn(`[cz-agents/eu-registry] ${message}:`, error);
}
//# sourceMappingURL=fr-sirene.js.map