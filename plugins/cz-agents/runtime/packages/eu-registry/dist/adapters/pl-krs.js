const API_BASE = 'https://api-krs.ms.gov.pl';
const REQUEST_TIMEOUT_MS = 10_000;
export class PlKrsAdapter {
    fetchImpl;
    constructor(fetchImpl = globalThis.fetch) {
        this.fetchImpl = fetchImpl;
    }
    // KRS name-search endpoint (WyszukiwanieKRS) was retired post-2024 eKRS migration.
    // Only lookup-by-KRS-number is available via the free official API.
    async searchByName(_name, _limit = 10) {
        return { companies: [], total_results: 0 };
    }
    async getById(id) {
        const primary = await fetchKrsRecord(this.fetchImpl, id, 'P');
        const payload = primary ?? (await fetchKrsRecord(this.fetchImpl, id, 'S'));
        if (!payload)
            return null;
        return mapRecord(payload, id);
    }
}
async function fetchKrsRecord(fetchImpl, id, rejestr) {
    const url = new URL(`/api/krs/OdpisAktualny/${encodeURIComponent(id)}`, API_BASE);
    url.searchParams.set('rejestr', rejestr);
    url.searchParams.set('format', 'json');
    try {
        const response = await fetchImpl(url, requestInit());
        if (!response.ok) {
            if (response.status !== 404) {
                warn(`KRS company lookup failed: ${response.status} ${response.statusText}`);
            }
            return null;
        }
        const payload = await response.json();
        return isRecord(payload) ? payload : null;
    }
    catch (error) {
        warn('KRS company lookup failed', error);
        return null;
    }
}
function mapRecord(record, fallbackId) {
    const id = firstString(record, ['numerKRS', 'nrKRS']) ?? fallbackId;
    const name = firstString(record, ['nazwa', 'firma', 'nazwaPodmiotu']);
    if (!id || !name)
        return null;
    return {
        id,
        country: 'pl',
        name,
        status: mapStatus(firstString(record, ['statusPodmiotu', 'status'])),
        address: formatAddress(firstValue(record, ['adres', 'siedzibaIAdres'])),
        registered_on: firstString(record, ['dataRejestracjiWKRS']),
        source_url: sourceUrl(id),
    };
}
function requestInit() {
    return {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
    };
}
function mapStatus(status) {
    const normalized = status?.toLowerCase();
    if (normalized === 'czynny')
        return 'active';
    if (normalized === 'wykreślony')
        return 'dissolved';
    return 'unknown';
}
function sourceUrl(id) {
    return `https://ekrs.ms.gov.pl/web/wyszukiwarka-krs/strona-glowna/wyszukaj?numer=${encodeURIComponent(id)}`;
}
function formatAddress(address) {
    if (typeof address === 'string')
        return address || undefined;
    if (!isRecord(address))
        return undefined;
    const formatted = stringValue(address, 'adres') ?? stringValue(address, 'formattedAddress');
    if (formatted)
        return formatted;
    const parts = [
        firstString(address, ['ulica']),
        firstString(address, ['nrDomu', 'numerDomu']),
        firstString(address, ['nrLokalu', 'numerLokalu']),
        firstString(address, ['kodPocztowy']),
        firstString(address, ['miejscowosc', 'miejscowość']),
        firstString(address, ['kraj']),
    ].filter((part) => Boolean(part));
    return parts.length > 0 ? parts.join(', ') : undefined;
}
function firstString(record, keys) {
    for (const key of keys) {
        const direct = stringValue(record, key);
        if (direct)
            return direct;
    }
    for (const value of Object.values(record)) {
        if (isRecord(value)) {
            const nested = firstString(value, keys);
            if (nested)
                return nested;
        }
        else if (Array.isArray(value)) {
            for (const item of value) {
                if (!isRecord(item))
                    continue;
                const nested = firstString(item, keys);
                if (nested)
                    return nested;
            }
        }
    }
    return undefined;
}
function firstValue(record, keys) {
    for (const key of keys) {
        if (record[key] !== undefined)
            return record[key];
    }
    for (const value of Object.values(record)) {
        if (isRecord(value)) {
            const nested = firstValue(value, keys);
            if (nested !== undefined)
                return nested;
        }
        else if (Array.isArray(value)) {
            for (const item of value) {
                if (!isRecord(item))
                    continue;
                const nested = firstValue(item, keys);
                if (nested !== undefined)
                    return nested;
            }
        }
    }
    return undefined;
}
function stringValue(record, key) {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function warn(message, error) {
    if (error === undefined)
        console.warn(`[cz-agents/eu-registry] ${message}`);
    else
        console.warn(`[cz-agents/eu-registry] ${message}:`, error);
}
//# sourceMappingURL=pl-krs.js.map