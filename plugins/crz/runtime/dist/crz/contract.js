import * as cheerio from "cheerio";
import { CRZ_BASE_URL, httpGet } from "./client.js";
import { cacheGet, cacheSet, TTL } from "./cache.js";
import { parseEuroAmount } from "./money.js";
const ATTACH_HREF_RE = /^\/data\/att\/(\d+)\.([a-z0-9]+)$/i;
function clean(s) {
    if (s == null)
        return undefined;
    const t = s.replace(/\s+/g, " ").trim();
    return t.length ? t : undefined;
}
function labelKey(label) {
    return label
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}
function parseParty(value) {
    if (!value)
        return undefined;
    const parts = value.split(/\n|<br\s*\/?\s*>/i).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0)
        return undefined;
    return {
        name: parts[0],
        address: parts.slice(1).join(", ") || undefined,
    };
}
export function parseContractHtml(html, id) {
    const $ = cheerio.load(html);
    const warnings = [];
    const contract = {
        id: String(id),
        url: `${CRZ_BASE_URL}/zmluva/${id}/`,
        attachments: [],
        warnings,
    };
    // The detail page consists of several `.card` blocks each starting with `h2.card-header`.
    // Walk cards by their header text. Each row is `li > div.row > strong (label) + span (value)`.
    const cards = $("div.card").toArray();
    let lastSeenIcoOwner = null;
    for (const card of cards) {
        const $card = $(card);
        const heading = clean($card.find("> h2.card-header").first().text())?.toLowerCase() ?? "";
        if (!heading)
            continue;
        if (heading.includes("identifik")) {
            $card.find("li").each((_, li) => {
                const $li = $(li);
                const label = clean($li.find("strong").first().text())?.replace(/:$/, "");
                const span = $li.find("span").first();
                const valueHtml = span.html() ?? "";
                const valueText = clean(span.text());
                if (!label)
                    return;
                const key = labelKey(label);
                switch (key) {
                    case "typ":
                        contract.typ = valueText;
                        break;
                    case "czmluvy":
                    case "cislozmluvy":
                        contract.cislo_zmluvy = valueText;
                        break;
                    case "rezort":
                        contract.rezort = valueText;
                        break;
                    case "objednavatel": {
                        contract.objednavatel = parseParty(decodeBr(valueHtml));
                        lastSeenIcoOwner = "objednavatel";
                        break;
                    }
                    case "dodavatel": {
                        contract.dodavatel = parseParty(decodeBr(valueHtml));
                        lastSeenIcoOwner = "dodavatel";
                        break;
                    }
                    case "ico": {
                        if (lastSeenIcoOwner === "objednavatel" && contract.objednavatel) {
                            contract.objednavatel.ico = valueText;
                        }
                        else if (lastSeenIcoOwner === "dodavatel" && contract.dodavatel) {
                            contract.dodavatel.ico = valueText;
                        }
                        break;
                    }
                    case "nazovzmluvy":
                        contract.nazov = valueText;
                        break;
                    case "popis":
                    case "predmet":
                        contract.predmet = valueText;
                        break;
                    case "idzmluvy":
                        contract.id = valueText ?? contract.id;
                        break;
                    case "zverejnil":
                        contract.zverejnil = valueText;
                        break;
                    default: break;
                }
            });
        }
        else if (heading.includes("datum") || heading.includes("dátum")) {
            $card.find("li").each((_, li) => {
                const $li = $(li);
                const label = clean($li.find("strong").first().text())?.replace(/:$/, "");
                const value = clean($li.find("span").first().text());
                if (!label || !value || value.toLowerCase() === "neuvedený" || value.toLowerCase() === "neuvedena")
                    return;
                const key = labelKey(label);
                switch (key) {
                    case "datumzverejnenia":
                        contract.datum_zverejnenia = value;
                        break;
                    case "datumuzavretia":
                        contract.datum_uzavretia = value;
                        break;
                    case "datumucinnosti":
                        contract.datum_ucinnosti = value;
                        break;
                    case "datumplatnostido":
                        contract.datum_platnosti_do = value;
                        break;
                    default: break;
                }
            });
        }
        else if (heading.includes("priloh") || heading.includes("príloh")) {
            $card.find("li").each((_, li) => {
                const $li = $(li);
                const a = $li.find("a[href^='/data/att/']").first();
                if (!a.length)
                    return;
                const href = a.attr("href") ?? "";
                const m = ATTACH_HREF_RE.exec(href);
                if (!m)
                    return;
                const [, file_id, ext] = m;
                const name = clean(a.text()) ?? `${file_id}.${ext}`;
                const kindRaw = clean($li.find("span.fs-9").first().text())?.toLowerCase();
                const sizeMatch = /\(\.[a-z0-9]+,\s*([\d.,]+)\s*([kKmMgG]?B)\)/.exec($li.text());
                let size_kb;
                if (sizeMatch) {
                    const n = parseFloat(sizeMatch[1].replace(/\s/g, "").replace(",", "."));
                    const unit = sizeMatch[2].toUpperCase();
                    if (!Number.isNaN(n)) {
                        size_kb = unit.startsWith("M") ? n * 1024 : unit.startsWith("G") ? n * 1024 * 1024 : unit.startsWith("B") ? n / 1024 : n;
                    }
                }
                const att = {
                    file_id,
                    name,
                    ext: ext.toLowerCase(),
                    size_kb,
                    mime: extToMime(ext),
                    url: `${CRZ_BASE_URL}${href}`,
                    kind: kindRaw,
                };
                contract.attachments.push(att);
            });
        }
        else if (heading.includes("cenov")) {
            const raw = clean($card.text());
            const dohodnuta = /Zmluvne\s+dohodnut[aá]\s+čiastka:\s*([0-9\s.,]+\s*€?)/i.exec($card.text());
            const celkova = /Celkov[aá]\s+čiastka:\s*([0-9\s.,]+\s*€?)/i.exec($card.text());
            const zmluvne_dohodnuta = clean(dohodnuta?.[1]);
            const celkovaStr = clean(celkova?.[1]);
            contract.cena = {
                zmluvne_dohodnuta,
                celkova: celkovaStr,
                raw,
                eur: parseEuroAmount(celkovaStr ?? zmluvne_dohodnuta),
            };
        }
    }
    if (!contract.cislo_zmluvy && !contract.nazov && !contract.objednavatel) {
        warnings.push("contract_html_parse_yielded_no_core_fields");
    }
    return contract;
}
function decodeBr(html) {
    return html
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}
function extToMime(ext) {
    const e = ext.toLowerCase();
    if (e === "pdf")
        return "application/pdf";
    if (e === "doc")
        return "application/msword";
    if (e === "docx")
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (e === "xls")
        return "application/vnd.ms-excel";
    if (e === "xlsx")
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (e === "rtf")
        return "application/rtf";
    if (e === "zip")
        return "application/zip";
    if (e === "txt")
        return "text/plain";
    if (e === "png")
        return "image/png";
    if (e === "jpg" || e === "jpeg")
        return "image/jpeg";
    return "application/octet-stream";
}
export async function getContract(id, opts = {}) {
    const idStr = String(id).trim();
    if (!/^\d+$/.test(idStr)) {
        throw new Error(`Invalid contract id: ${idStr}`);
    }
    if (!opts.fresh) {
        const cached = await cacheGet("contract", idStr, TTL.CONTRACT_MS);
        if (cached)
            return cached;
    }
    const url = `${CRZ_BASE_URL}/zmluva/${idStr}/`;
    const res = await httpGet(url);
    if (res.status === 404) {
        throw new Error(`Contract ${idStr} not found (404).`);
    }
    if (res.status >= 400) {
        throw new Error(`CRZ returned ${res.status} for ${url}`);
    }
    const parsed = parseContractHtml(res.text(), idStr);
    await cacheSet("contract", idStr, parsed, TTL.CONTRACT_MS);
    // Remember each attachment's extension (namespace shared with attachments.ts)
    // so a later crz_download_attachment without `ext` skips blind 404 probing.
    for (const att of parsed.attachments) {
        await cacheSet("attext", att.file_id, att.ext, TTL.CONTRACT_MS);
    }
    return parsed;
}
//# sourceMappingURL=contract.js.map