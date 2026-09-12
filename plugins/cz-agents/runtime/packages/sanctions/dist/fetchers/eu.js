/**
 * EU Financial Sanctions consolidated list parser.
 *
 * Source: webgate.ec.europa.eu/fsd/fsf — XML export, free, requires bound token
 * (URL pattern: .../public/files/xmlFullSanctionsList_1_1/content?token=<TOKEN>)
 *
 * Schema reference (EU FSF 1.1):
 *   <export ...>
 *     <sanctionEntity euReferenceNumber="..." designationDate="2022-02-25">
 *       <subjectType code="P|E"/>
 *       <nameAlias firstName="..." lastName="..." wholeName="..." function="..."/>
 *       <birthdate birthdate="1965-03-12" country="..."/>
 *       <citizenship countryDescription="..." region="..."/>
 *       <address street="..." city="..." countryDescription="..."/>
 *       <identification documentType="passport" number="..." countryDescription="..."/>
 *       <regulation programme="..."/>
 *     </sanctionEntity>
 *   </export>
 */
import { XMLParser } from 'fast-xml-parser';
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    isArray: (name) => ['sanctionEntity', 'nameAlias', 'birthdate', 'citizenship', 'address', 'identification', 'regulation'].includes(name),
});
export function parseEu(xml) {
    const tree = parser.parse(xml);
    const raws = tree.export?.sanctionEntity ?? [];
    const out = [];
    for (const r of raws) {
        const e = mapEntity(r);
        if (e)
            out.push(e);
    }
    return out;
}
function mapEntity(r) {
    const sourceListId = r['@_logicalId'] ?? r['@_euReferenceNumber'] ?? '';
    if (!sourceListId)
        return null;
    const aliasRaw = r.nameAlias ?? [];
    if (aliasRaw.length === 0)
        return null;
    // Pick whole-name in latin script as primary, fallback to constructed
    const primary = aliasRaw.find((a) => a['@_wholeName'] && (a['@_nameLanguage'] === undefined || a['@_nameLanguage'] === 'EN'))
        ?? aliasRaw[0];
    const primaryName = primary?.['@_wholeName']?.trim()
        || joinName(primary?.['@_firstName'], primary?.['@_middleName'], primary?.['@_lastName']);
    if (!primaryName)
        return null;
    const aliases = [];
    for (const a of aliasRaw) {
        const whole = a['@_wholeName']?.trim();
        if (whole && whole !== primaryName)
            aliases.push(whole);
        const built = joinName(a['@_firstName'], a['@_middleName'], a['@_lastName']);
        if (built && built !== primaryName && !aliases.includes(built))
            aliases.push(built);
    }
    const dobs = (r.birthdate ?? [])
        .map((b) => b['@_birthdate'] || b['@_year'])
        .filter((s) => Boolean(s));
    const nationalities = (r.citizenship ?? [])
        .map((c) => c['@_countryDescription'])
        .filter((s) => Boolean(s));
    const addresses = (r.address ?? []).map((a) => ({
        street: attrOrUndef(a['@_street']),
        city: attrOrUndef(a['@_city']),
        region: attrOrUndef(a['@_region']),
        postal_code: attrOrUndef(a['@_zipCode']),
        country: a['@_country'] ?? a['@_countryDescription'],
    }));
    const ids = (r.identification ?? [])
        .filter((i) => i['@_number'])
        .map((i) => ({
        type: i['@_documentType'] ?? 'document',
        value: i['@_number'].trim(),
        country: i['@_country'] ?? i['@_countryDescription'],
    }));
    const programs = (r.regulation ?? [])
        .map((p) => p['@_programme'])
        .filter((s) => Boolean(s))
        .map((s) => `EU.${s}`);
    const code = r.subjectType?.['@_code'];
    const type = code === 'P' ? 'person' : 'entity';
    return {
        id: `eu:${sourceListId}`,
        source: 'eu',
        source_list_id: sourceListId,
        type,
        primary_name: primaryName,
        aliases,
        dobs: dobs.length > 0 ? dobs : undefined,
        nationalities: nationalities.length > 0 ? nationalities : undefined,
        addresses: addresses.length > 0 ? addresses : undefined,
        ids: ids.length > 0 ? ids : undefined,
        programs,
        listed_on: r['@_designationDate'],
        remarks: r.remark,
        raw: r,
    };
}
function attrOrUndef(v) {
    return v && v.trim().length > 0 ? v.trim() : undefined;
}
function joinName(...parts) {
    return parts.filter((p) => p && p.trim().length > 0).join(' ').trim();
}
//# sourceMappingURL=eu.js.map