import { SOURCES } from './fetchers/index.js';
export async function refreshAll(db) {
    const summaries = [];
    for (const def of SOURCES) {
        summaries.push(await refreshSource(db, def));
    }
    return summaries;
}
async function refreshSource(db, def) {
    const url = def.url();
    if (!url) {
        return {
            source: def.source,
            ok: false,
            fetched: 0,
            added: 0,
            modified: 0,
            removed: 0,
            error: `No URL configured for ${def.source} (env var missing).`,
        };
    }
    try {
        const xml = await fetchXml(url);
        const entities = def.parse(xml);
        const diff = db.upsertSource(def.source, entities);
        return { source: def.source, ok: true, fetched: entities.length, ...diff };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        db.recordRefreshFailure(def.source, msg);
        return {
            source: def.source,
            ok: false,
            fetched: 0,
            added: 0,
            modified: 0,
            removed: 0,
            error: msg,
        };
    }
}
async function fetchXml(url) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 60_000);
    try {
        const res = await fetch(url, {
            signal: ac.signal,
            redirect: 'follow',
            headers: {
                Accept: 'application/xml, text/xml',
                'User-Agent': 'cz-agents-sanctions/0.1.0 (+https://mcp.example.com)',
            },
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
        return await res.text();
    }
    finally {
        clearTimeout(t);
    }
}
//# sourceMappingURL=refresh.js.map