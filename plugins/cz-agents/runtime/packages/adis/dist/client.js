/**
 * AdisClient — talks to the MFČR Registr CRPDPH SOAP service to determine
 * VAT-payer reliability ("nespolehlivý plátce DPH"), retrieve published
 * bank accounts (§ 96a ZDPH transparent accounts), and resolve subject
 * type / name / address.
 *
 * Endpoint: https://adisrws.mfcr.cz/adistc/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP
 * WSDL:    add ?wsdl
 *
 * Operations used:
 *   - getStatusNespolehlivySubjektRozsirenyV2  (single/bulk lookup with full info)
 *   - getStatusNespolehlivyPlatce              (lighter bulk lookup, no name/address)
 *   - getSeznamNespolehlivyPlatce              (full unreliable-payer list, no input)
 *
 * Status semantics (per WSDL annotations):
 *   reliability:
 *     ANO       = subject IS unreliable (red flag)
 *     NE        = subject is reliable
 *     NENALEZEN = DIČ not found in registry (not a VAT payer)
 *   service.status_code:
 *     0 = OK
 *     1 = data integrity error (some entries may be missing)
 *     2 = scheduled maintenance window 00:00–00:10
 *     3 = service unavailable
 *
 * No authentication. Public service. Batch limit: 100 DIČ per request.
 *
 * Set ADIS_SOAP_ENABLED=1 (or pass `stub: false` constructor opt) to actually
 * hit the network. Default in tests is offline stub returning empty results,
 * matching the @czagents/isir convention.
 */
import { XMLParser } from 'fast-xml-parser';
const DEFAULT_ENDPOINT = 'https://adisrws.mfcr.cz/adistc/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP';
const SOAP_NAMESPACE = 'http://adis.mfcr.cz/rozhraniCRPDPH/';
/** ADIS hard limit per request. */
export const MAX_DIC_PER_REQUEST = 100;
export class AdisClient {
    endpoint;
    stub;
    fetchImpl;
    timeoutMs;
    parser;
    constructor(opts = {}) {
        this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
        this.stub = opts.stub ?? !process.env.ADIS_SOAP_ENABLED;
        this.fetchImpl = opts.fetchImpl ?? fetch;
        this.timeoutMs = opts.timeoutMs ?? 30_000;
        this.parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            removeNSPrefix: true,
            // PSČ "17000", cisloFu "009", account numbers, predcisli — all must stay
            // strings; fast-xml-parser otherwise coerces to number and "009"→9 loses
            // the leading zero that's required by Czech format.
            parseAttributeValue: false,
            parseTagValue: false,
            isArray: (name) => name === 'statusPlatceDPH' || name === 'statusSubjektu' || name === 'standardniUcet',
        });
    }
    /**
     * Single-DIČ extended check. Returns reliability + subject type + name + address + accounts.
     * Pass either `dic` (e.g. "CZ27074358") or `ico` (will be converted to DIČ "CZ${ico}").
     *
     * Returns null when the DIČ is not in the VAT registry (reliability would be 'NENALEZEN').
     * Throws on network or SOAP errors.
     */
    async checkPayer(input) {
        const dic = resolveDic(input);
        if (this.stub)
            return null;
        const result = await this.callSubjectV2([dic]);
        const found = result.results.find((r) => r.dic === dic) ?? null;
        if (!found)
            return null;
        if (found.reliability === 'NENALEZEN')
            return null;
        return found;
    }
    /**
     * Bulk basic check: reliability status + accounts only (no name/address). Faster,
     * suitable for screening 100 invoices at a time. Returns one entry per DIČ in input;
     * NENALEZEN entries are kept (caller decides how to handle "not in registry").
     */
    async checkBulk(input) {
        const dics = (input.dics ?? []).slice();
        if (input.icos)
            for (const ico of input.icos)
                dics.push(icoToDic(ico));
        if (dics.length === 0) {
            return {
                service: { generated_on: new Date().toISOString().slice(0, 10), status_code: 0, status_text: 'OK (no input)' },
                results: [],
            };
        }
        if (dics.length > MAX_DIC_PER_REQUEST) {
            throw new Error(`ADIS request limit is ${MAX_DIC_PER_REQUEST} DIČ; received ${dics.length}. Split into batches.`);
        }
        if (this.stub) {
            return {
                service: { generated_on: new Date().toISOString().slice(0, 10), status_code: 0, status_text: 'OK (stub)' },
                results: dics.map((dic) => stubResult(dic)),
            };
        }
        return this.callBasic(dics);
    }
    /**
     * Full list of unreliable VAT payers. Response can be 50–100 MB (tens of thousands
     * of entries). Use sparingly — typically once a day for a local mirror.
     */
    async listUnreliable() {
        if (this.stub) {
            return {
                service: { generated_on: new Date().toISOString().slice(0, 10), status_code: 0, status_text: 'OK (stub)' },
                unreliable: [],
            };
        }
        const xml = buildListEnvelope();
        const body = await this.post(xml, 'getSeznamNespolehlivyPlatce');
        return this.parseListResponse(body);
    }
    // ---- private SOAP plumbing ----
    async callSubjectV2(dics) {
        const xml = buildSubjectV2Envelope(dics);
        const body = await this.post(xml, 'getStatusNespolehlivySubjektRozsirenyV2');
        return this.parseSubjectV2Response(body);
    }
    async callBasic(dics) {
        const xml = buildBasicEnvelope(dics);
        const body = await this.post(xml, 'getStatusNespolehlivyPlatce');
        return this.parseBasicResponse(body);
    }
    async post(xml, soapAction) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), this.timeoutMs);
        let resp;
        try {
            resp = await this.fetchImpl(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    SOAPAction: `${SOAP_NAMESPACE}${soapAction}`,
                },
                body: xml,
                signal: ac.signal,
            });
        }
        finally {
            clearTimeout(t);
        }
        const body = await resp.text();
        if (!resp.ok) {
            const fault = extractFault(body);
            throw new Error(`ADIS HTTP ${resp.status}${fault ? `: ${fault}` : ''}`);
        }
        return body;
    }
    // ---- response parsing ----
    parseSubjectV2Response(xml) {
        const tree = this.parser.parse(xml);
        const body = tree.Envelope?.Body;
        if (!body)
            throw new Error('Malformed ADIS SOAP envelope (no Body)');
        if (body.Fault)
            throw new Error(`ADIS SOAP Fault: ${body.Fault.faultstring ?? 'unknown'}`);
        const r = body.StatusNespolehlivySubjektRozsirenyResponse;
        if (!r)
            throw new Error('No StatusNespolehlivySubjektRozsirenyResponse in body');
        const service = parseStatus(r.status);
        const results = (r.statusSubjektu ?? []).map(parseSubjectV2Entry);
        return { service, results };
    }
    parseBasicResponse(xml) {
        const tree = this.parser.parse(xml);
        const body = tree.Envelope?.Body;
        if (!body)
            throw new Error('Malformed ADIS SOAP envelope (no Body)');
        if (body.Fault)
            throw new Error(`ADIS SOAP Fault: ${body.Fault.faultstring ?? 'unknown'}`);
        const r = body.StatusNespolehlivyPlatceResponse;
        if (!r)
            throw new Error('No StatusNespolehlivyPlatceResponse in body');
        const service = parseStatus(r.status);
        const results = (r.statusPlatceDPH ?? []).map(parseBasicEntry);
        return { service, results };
    }
    parseListResponse(xml) {
        const tree = this.parser.parse(xml);
        const body = tree.Envelope?.Body;
        if (!body)
            throw new Error('Malformed ADIS SOAP envelope (no Body)');
        if (body.Fault)
            throw new Error(`ADIS SOAP Fault: ${body.Fault.faultstring ?? 'unknown'}`);
        const r = body.SeznamNespolehlivyPlatceResponse ?? body.StatusNespolehlivyPlatceResponse;
        if (!r)
            throw new Error('No list response element in body');
        const service = parseStatus(r.status);
        const unreliable = (r.statusPlatceDPH ?? []).map(parseBasicEntry);
        return { service, unreliable };
    }
}
// ---- shared helpers ----
export function icoToDic(ico) {
    const trimmed = ico.trim();
    if (/^CZ\d{1,10}$/i.test(trimmed))
        return trimmed.toUpperCase();
    if (!/^\d{1,10}$/.test(trimmed)) {
        throw new Error(`Invalid IČO/DIČ: "${ico}". Expected 1–10 digits or CZ-prefixed DIČ.`);
    }
    return `CZ${trimmed}`;
}
function dicToIco(dic) {
    const m = /^CZ(\d{1,10})$/i.exec(dic);
    return m ? m[1] : null;
}
function resolveDic(input) {
    if (input.dic)
        return icoToDic(input.dic);
    if (input.ico)
        return icoToDic(input.ico);
    throw new Error('Either `ico` or `dic` is required');
}
function stubResult(dic) {
    return { dic, ico: dicToIco(dic), reliability: 'NENALEZEN', accounts: [] };
}
function parseStatus(s) {
    return {
        generated_on: String(s?.['@_odpovedGenerovana'] ?? ''),
        status_code: Number(s?.['@_statusCode'] ?? 0),
        status_text: String(s?.['@_statusText'] ?? ''),
    };
}
function parseBasicEntry(e) {
    const dic = String(e['@_dic'] ?? '');
    return {
        dic,
        ico: dicToIco(dic),
        reliability: (e['@_nespolehlivyPlatce'] ?? 'NENALEZEN'),
        unreliable_since: e['@_datumZverejneniNespolehlivosti'],
        tax_office: e['@_cisloFu'],
        accounts: parseAccounts(e.zverejneneUcty?.standardniUcet),
    };
}
function parseSubjectV2Entry(e) {
    const base = parseBasicEntry(e);
    const subject_type = e['@_typSubjektu'];
    const subject_name = e.nazevSubjektu;
    const address = parseAddress(e.adresa);
    return { ...base, subject_type, subject_name, address };
}
function parseAccounts(raw) {
    if (!raw)
        return [];
    return raw.map((a) => {
        const predcisli = a['@_predcisli'];
        const cislo = String(a['@_cislo'] ?? '');
        const kod_banky = String(a['@_kodBanky'] ?? '');
        const formatted = `${predcisli ? predcisli + '-' : ''}${cislo}/${kod_banky}`;
        return {
            predcisli,
            cislo,
            kod_banky,
            publikovan_od: a['@_datumZverejneni'],
            publikovan_do: a['@_datumUkonceniZverejneni'],
            formatted,
        };
    });
}
function parseAddress(a) {
    if (!a)
        return undefined;
    return {
        ulice_cislo: a.uliceCislo,
        cast_obce: a.castObce,
        mesto: a.mesto,
        psc: a.psc,
        stat: a.stat,
    };
}
// ---- envelope builders ----
export function buildBasicEnvelope(dics) {
    const parts = dics.map((d) => `<adis:dic>${escapeXml(d)}</adis:dic>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:adis="${SOAP_NAMESPACE}">
  <soap:Body>
    <adis:StatusNespolehlivyPlatceRequest>${parts}</adis:StatusNespolehlivyPlatceRequest>
  </soap:Body>
</soap:Envelope>`;
}
export function buildSubjectV2Envelope(dics) {
    const parts = dics.map((d) => `<adis:dic>${escapeXml(d)}</adis:dic>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:adis="${SOAP_NAMESPACE}">
  <soap:Body>
    <adis:StatusNespolehlivySubjektRozsirenyV2Request>${parts}</adis:StatusNespolehlivySubjektRozsirenyV2Request>
  </soap:Body>
</soap:Envelope>`;
}
export function buildListEnvelope() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:adis="${SOAP_NAMESPACE}">
  <soap:Body>
    <adis:SeznamNespolehlivyPlatceRequest/>
  </soap:Body>
</soap:Envelope>`;
}
function escapeXml(s) {
    return s.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case "'": return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}
function extractFault(body) {
    const m = /<faultstring[^>]*>([^<]+)<\/faultstring>/i.exec(body);
    return m?.[1] ?? null;
}
//# sourceMappingURL=client.js.map