const API_BASE = 'https://api.company-information.service.gov.uk';
const SOURCE_BASE = 'https://find-and-update.company-information.service.gov.uk/company';
export class UkCompaniesHouseAdapter {
    apiKey;
    fetchImpl;
    constructor(apiKey = process.env.CH_API_KEY, fetchImpl = globalThis.fetch) {
        this.apiKey = apiKey;
        this.fetchImpl = fetchImpl;
    }
    async searchByName(name, limit = 10) {
        if (!this.apiKey) {
            warnMissingApiKey();
            return { companies: [], total_results: 0 };
        }
        const url = new URL('/search/companies', API_BASE);
        url.searchParams.set('q', name);
        url.searchParams.set('items_per_page', String(limit));
        const response = await this.fetchImpl(url, { headers: this.authHeaders() });
        if (!response.ok) {
            throw new Error(`Companies House search failed: ${response.status} ${response.statusText}`);
        }
        const payload = (await response.json());
        const companies = (payload.items ?? [])
            .map(mapSearchItem)
            .filter((company) => company !== null);
        return {
            companies,
            total_results: payload.total_results ?? companies.length,
        };
    }
    async getById(id) {
        if (!this.apiKey) {
            warnMissingApiKey();
            return null;
        }
        const response = await this.fetchImpl(`${API_BASE}/company/${encodeURIComponent(id)}`, {
            headers: this.authHeaders(),
        });
        if (response.status === 404)
            return null;
        if (!response.ok) {
            throw new Error(`Companies House company lookup failed: ${response.status} ${response.statusText}`);
        }
        const payload = (await response.json());
        return mapCompany(payload);
    }
    authHeaders() {
        return {
            Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
            Accept: 'application/json',
        };
    }
}
function mapSearchItem(item) {
    if (!item.company_number || !item.title)
        return null;
    return {
        id: item.company_number,
        country: 'gb',
        name: item.title,
        status: mapStatus(item.company_status),
        address: item.address_snippet ?? formatAddress(item.address),
        registered_on: item.date_of_creation,
        source_url: `${SOURCE_BASE}/${item.company_number}`,
    };
}
function mapCompany(company) {
    if (!company.company_number || !company.company_name)
        return null;
    return {
        id: company.company_number,
        country: 'gb',
        name: company.company_name,
        status: mapStatus(company.company_status),
        address: formatAddress(company.registered_office_address),
        registered_on: company.date_of_creation,
        source_url: `${SOURCE_BASE}/${company.company_number}`,
    };
}
function mapStatus(status) {
    if (status === 'active')
        return 'active';
    if (status === 'dissolved')
        return 'dissolved';
    return 'unknown';
}
function formatAddress(address) {
    if (!address)
        return undefined;
    const parts = [
        address.address_line_1,
        address.address_line_2,
        address.locality,
        address.region,
        address.postal_code,
        address.country,
    ].filter((part) => Boolean(part));
    return parts.length > 0 ? parts.join(', ') : undefined;
}
function warnMissingApiKey() {
    console.warn('[cz-agents/eu-registry] CH_API_KEY is not set; Companies House adapter disabled.');
}
//# sourceMappingURL=uk-companies-house.js.map