/**
 * OFAC SDN list parser.
 *
 * Source: home.treasury.gov / sanctionslistservice.ofac.treas.gov — XML, free, daily.
 * Schema reference (SDN.XML simplified subset):
 *   <sdnList>
 *     <sdnEntry>
 *       <uid>12345</uid>
 *       <firstName>...</firstName>
 *       <lastName>...</lastName>
 *       <sdnType>Individual|Entity|Vessel|Aircraft</sdnType>
 *       <programList><program>SDGT</program></programList>
 *       <akaList><aka><type>a.k.a.</type><lastName>...</lastName><firstName>...</firstName></aka></akaList>
 *       <addressList><address><address1>...</address1><city>...</city><country>...</country></address></addressList>
 *       <dateOfBirthList><dateOfBirthItem><dateOfBirth>1965</dateOfBirth></dateOfBirthItem></dateOfBirthList>
 *       <nationalityList><nationality><country>...</country></nationality></nationalityList>
 *       <idList><id><idType>Passport</idType><idNumber>X1234</idNumber><idCountry>...</idCountry></id></idList>
 *     </sdnEntry>
 *   </sdnList>
 */
import { XMLParser } from 'fast-xml-parser';
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    isArray: (name) => [
        'sdnEntry',
        'aka',
        'address',
        'dateOfBirthItem',
        'nationality',
        'id',
        'program',
    ].includes(name),
});
export function parseOfac(xml) {
    const tree = parser.parse(xml);
    const raws = tree.sdnList?.sdnEntry ?? [];
    const out = [];
    for (const r of raws) {
        const mapped = mapEntry(r);
        if (mapped)
            out.push(mapped);
    }
    return out;
}
function mapEntry(r) {
    const uid = r.uid !== undefined ? String(asString(r.uid) ?? r.uid) : '';
    if (!uid)
        return null;
    const primaryName = joinName(asString(r.firstName), asString(r.lastName));
    if (!primaryName)
        return null;
    const aliases = [];
    for (const aka of r.akaList?.aka ?? []) {
        const name = joinName(asString(aka.firstName), asString(aka.lastName));
        if (name && name !== primaryName && !aliases.includes(name))
            aliases.push(name);
    }
    const dobs = (r.dateOfBirthList?.dateOfBirthItem ?? [])
        .map((d) => asString(d.dateOfBirth))
        .filter((s) => Boolean(s));
    const nationalities = (r.nationalityList?.nationality ?? [])
        .map((n) => asString(n.country))
        .filter((s) => Boolean(s));
    const addresses = (r.addressList?.address ?? []).map((a) => ({
        street: joinAddressLines(asString(a.address1), asString(a.address2)),
        city: asString(a.city),
        region: asString(a.stateOrProvince),
        postal_code: asString(a.postalCode),
        country: asString(a.country),
    }));
    const ids = (r.idList?.id ?? [])
        .filter((i) => i.idNumber !== undefined && i.idNumber !== null)
        .map((i) => ({
        type: asString(i.idType) ?? 'document',
        value: String(asString(i.idNumber) ?? i.idNumber).trim(),
        country: asString(i.idCountry),
    }));
    const programs = (r.programList?.program ?? [])
        .map((p) => asString(p))
        .filter((s) => Boolean(s))
        .map((s) => `OFAC.${s}`);
    const sdnType = (asString(r.sdnType) ?? 'Entity').toLowerCase();
    const type = sdnType === 'individual'
        ? 'person'
        : sdnType === 'vessel'
            ? 'vessel'
            : sdnType === 'aircraft'
                ? 'aircraft'
                : 'entity';
    return {
        id: `ofac:${uid}`,
        source: 'ofac',
        source_list_id: uid,
        type,
        primary_name: primaryName,
        aliases,
        dobs: dobs.length > 0 ? dobs : undefined,
        nationalities: nationalities.length > 0 ? nationalities : undefined,
        addresses: addresses.length > 0 ? addresses : undefined,
        ids: ids.length > 0 ? ids : undefined,
        programs,
        remarks: asString(r.remarks),
        raw: r,
    };
}
function joinName(...parts) {
    return parts
        .map((p) => (typeof p === 'string' ? p.trim() : typeof p === 'number' ? String(p) : ''))
        .filter((s) => s.length > 0)
        .join(' ')
        .trim();
}
function joinAddressLines(...parts) {
    const strs = parts
        .map((p) => (typeof p === 'string' ? p.trim() : ''))
        .filter((s) => s.length > 0);
    return strs.length > 0 ? strs.join(', ') : undefined;
}
function asString(v) {
    if (typeof v === 'string')
        return v.trim() || undefined;
    if (typeof v === 'number')
        return String(v);
    if (v && typeof v === 'object' && '#text' in v) {
        const t = v['#text'];
        return typeof t === 'string' ? t : typeof t === 'number' ? String(t) : undefined;
    }
    return undefined;
}
//# sourceMappingURL=ofac.js.map