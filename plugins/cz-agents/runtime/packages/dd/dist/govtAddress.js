/**
 * Static list of úřední addresses for the largest Czech cities.
 * Format: normalized "ulice cisloDomovni, obec" (no diacritics, lowercase).
 *
 * Source: cross-referenced from RUIAN entries for ÚMČ/MMR-listed
 * municipal offices, manually curated. Expand as encountered.
 */
// Static list pre-normalized (lowercase, no diacritics, no punctuation, single spaces).
// Keep entries in raw form here but normalize at construction time so
// authoring is readable and matching is deterministic.
const KNOWN_GOVT_ADDRESSES_RAW = [
    'Mariánské náměstí 2, Praha',
    'Havlíčkovo náměstí 9, Praha',
    'Orelská 38, Praha',
    'Mileticova 1, Praha',
    'Dominikánské náměstí 1, Brno',
    'Mendlovo náměstí 1, Brno',
    'Prokešovo náměstí 1228, Ostrava',
    'Náměstí republiky 1, Plzeň',
    'Náměstí Dr. E. Beneše 1, Liberec',
    'Horní náměstí 583, Olomouc',
    'Náměstí Přemysla Otakara II 1, České Budějovice',
    'Československé armády 408, Hradec Králové',
    'Pernštýnské náměstí 1, Pardubice',
    'Velká Hradební 8, Ústí nad Labem',
    'Náměstí Míru 12, Zlín',
];
// Markers — works without word-boundaries because Czech accented chars
// trip JS \b. Substring match is good enough; false-positive risk is
// tiny (these tokens almost never appear in residential street names).
const MARKER_PATTERN = /(úřad|urad|magistrát|magistrat|radnice|městská\s*část|mestska\s*cast|obecn[íi]\s+úřad|obecn[íi]\s+urad)/i;
export function detectGovtAddress(adresa) {
    if (!adresa)
        return { is_govt_address: false, signal: 'none' };
    // Signal 1: text markers
    const text = adresa.textovaAdresa ?? '';
    const markerHit = MARKER_PATTERN.exec(text);
    if (markerHit) {
        return { is_govt_address: true, signal: 'marker', matched_token: markerHit[0] };
    }
    // Signal 2: known static list lookup
    const norm = normalize(text);
    if (norm && KNOWN_GOVT_ADDRESSES.has(norm)) {
        return { is_govt_address: true, signal: 'known_address', matched_token: norm };
    }
    // Also try built address from structured fields
    if (adresa.nazevUlice && adresa.cisloDomovni && adresa.nazevObce) {
        const built = normalize(`${adresa.nazevUlice} ${adresa.cisloDomovni} ${adresa.nazevObce}`);
        if (KNOWN_GOVT_ADDRESSES.has(built)) {
            return { is_govt_address: true, signal: 'known_address', matched_token: built };
        }
    }
    return { is_govt_address: false, signal: 'none' };
}
const KNOWN_GOVT_ADDRESSES = new Set(KNOWN_GOVT_ADDRESSES_RAW.map(normalize));
function normalize(s) {
    return s
        .toLowerCase()
        .normalize('NFKD')
        .replace(/\p{Mn}/gu, '') // strip Unicode combining marks (Czech diacritics)
        .replace(/[.,]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
//# sourceMappingURL=govtAddress.js.map