const GLEIF_API = 'https://api.gleif.org/api/v1';
const LEGAL_SUFFIXES = /\b(s\.r\.o\.?|a\.s\.?|spol\. s r\.o\.?|k\.s\.?|v\.o\.s\.?|gmbh|ag|ltd|limited|bv|nv|sa|se|plc|oy|ab|as|llc|inc|corp|sàrl|srl|spa|aps|asa)\b\.?/gi;
function normalize(name) {
    return name.toLowerCase().replace(LEGAL_SUFFIXES, '').replace(/[,.\s]+/g, ' ').trim();
}
function computeConfidence(aresName, gleifName) {
    const a = normalize(aresName);
    const g = normalize(gleifName);
    if (!a || !g)
        return { confidence: 'LOW', score: 0 };
    if (a === g)
        return { confidence: 'HIGH', score: 1.0 };
    // One name fully contained in the other (e.g. "Siemens" in "Siemens s.r.o.")
    if (a.includes(g) || g.includes(a))
        return { confidence: 'MEDIUM', score: 0.85 };
    // Word overlap (ignore short words < 3 chars)
    const aWords = new Set(a.split(' ').filter((w) => w.length >= 3));
    const gWords = g.split(' ').filter((w) => w.length >= 3);
    if (gWords.length === 0)
        return { confidence: 'LOW', score: 0 };
    const matched = gWords.filter((w) => aWords.has(w)).length;
    const score = matched / gWords.length;
    if (score >= 0.66)
        return { confidence: 'MEDIUM', score };
    if (score >= 0.33)
        return { confidence: 'LOW', score };
    return { confidence: 'LOW', score };
}
export async function getByLei(lei) {
    try {
        const url = new URL(`${GLEIF_API}/lei-records/${encodeURIComponent(lei)}`);
        const res = await fetch(url.toString(), {
            headers: { Accept: 'application/vnd.api+json' },
        });
        if (!res.ok)
            return null;
        const json = await res.json();
        const record = json.data;
        if (!record)
            return null;
        const attrs = record.attributes;
        const entity = attrs?.entity;
        const name = entity?.legalName?.name ?? '';
        const jurisdiction = entity?.jurisdiction ?? '';
        if (!name)
            return null;
        return {
            lei: record.id,
            name,
            status: mapGleifStatus(entity?.status),
            country: jurisdiction.toLowerCase().slice(0, 2),
            jurisdiction,
            registered_as: entity?.registeredAs,
            address: formatGleifAddress(entity?.legalAddress),
            created_on: entity?.creationDate?.slice(0, 10),
            source_url: `https://search.gleif.org/#/record/${record.id}`,
        };
    }
    catch {
        return null;
    }
}
function mapGleifStatus(status) {
    const s = status?.toUpperCase();
    if (s === 'ACTIVE')
        return 'active';
    if (s === 'INACTIVE')
        return 'dissolved';
    return 'unknown';
}
function formatGleifAddress(addr) {
    if (!addr)
        return undefined;
    const lines = addr.addressLines ?? [];
    const parts = [...lines, addr.postalCode, addr.city]
        .filter((p) => Boolean(p));
    return parts.length > 0 ? parts.join(', ') : undefined;
}
export async function lookupGleifParent(companyName) {
    try {
        const url = new URL(`${GLEIF_API}/lei-records`);
        url.searchParams.set('filter[fulltext]', companyName);
        url.searchParams.set('page[size]', '5');
        const res = await fetch(url.toString(), {
            headers: { Accept: 'application/vnd.api+json' },
        });
        if (!res.ok)
            return null;
        const json = await res.json();
        const records = json.data;
        if (!Array.isArray(records) || records.length === 0)
            return null;
        const scored = records
            .map((r) => {
            const attrs = r.attributes;
            const entity = attrs?.entity;
            const gleifName = entity?.legalName?.name ?? '';
            const country = (entity?.jurisdiction ?? '').toLowerCase();
            const { confidence, score } = computeConfidence(companyName, gleifName);
            return {
                lei: r.id,
                name: gleifName,
                country,
                confidence,
                name_match_score: Math.round(score * 100) / 100,
                source_url: `https://search.gleif.org/#/record/${r.id}`,
            };
        })
            .filter((m) => m.name_match_score > 0)
            .sort((a, b) => b.name_match_score - a.name_match_score);
        return scored[0] ?? null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=gleif-lookup.js.map