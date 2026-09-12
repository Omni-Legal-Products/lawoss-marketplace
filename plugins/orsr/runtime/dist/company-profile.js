export function buildCompanyProfile(searchItem, extractFull, documents) {
    const cb = extractFull?.legalPerson?.corporateBody ?? {};
    const lp = extractFull?.legalPerson ?? {};
    const statutoryAll = mapPersonTimeline(cb?.statutoryBody);
    const stakeholderAll = mapStakeholders(cb?.stakeholder);
    const ownership = computeOwnershipFromDeposits(cb?.deposits);
    const predecessorEntities = stakeholderAll
        .filter((s) => includesInsensitive(s.typeCode ?? "", "predchod") || includesInsensitive(s.type ?? "", "predchod"))
        .map((s) => ({ name: s.name, ico: s.ico, od: s.od, do: s.do, current: s.current }));
    const legalFactsMentions = mapLegalFactsMentions(cb?.otherLegalFacts);
    return {
        subject: {
            nameCurrent: currentName(cb?.corporateBodyFullName) ?? searchItem?.corporateBodyFullName ?? null,
            ico: normalizeIco(searchItem?.registrationNumber) ?? extractIcoFromLegalPerson(lp) ?? null,
            fileReference: searchItem?.fileReference?.formattedValueSpaced ??
                extractFull?.fileReference?.formattedValueSpaced ??
                null,
            courtName: extractFull?.courtName ?? null,
            legalForm: stringify(extractFull?.legalForm),
            dataSyncDate: stringify(extractFull?.dataSyncDate),
            addressCurrent: formatAddress(pickCurrent(lp?.physicalAddress)) ?? stringify(searchItem?.physicalAddress),
        },
        nameHistory: mapSimpleHistory(cb?.corporateBodyFullName),
        statutoryBody: {
            current: statutoryAll.filter((x) => x.current),
            historical: statutoryAll.filter((x) => !x.current),
            all: sortTimeline(statutoryAll),
            statutoryBodyTypeHistory: mapSimpleHistory(cb?.statutoryBodyType),
        },
        stakeholders: {
            current: stakeholderAll.filter((x) => x.current),
            historical: stakeholderAll.filter((x) => !x.current),
            all: sortTimeline(stakeholderAll),
        },
        ownership,
        shares: {
            exists: Array.isArray(cb?.shares) && cb.shares.length > 0,
            items: mapShares(cb?.shares),
        },
        actingRules: {
            statutory: mapActingRules(cb?.authorizationToExecute),
            proxy: mapActingRules(cb?.proxyHolderAuthorizationToExecute),
            liquidator: mapActingRules(cb?.liquidatorAuthorizationToExecute),
        },
        accountingStatements: mapAccountingStatements(documents),
        mergerIndicators: {
            possibleMergerOrSuccession: predecessorEntities.length > 0 || legalFactsMentions.length > 0,
            predecessorEntities,
            legalFactsMentions,
        },
    };
}
export function buildCompanyBasicProfile(searchItem, extract) {
    const cb = extract?.legalPerson?.corporateBody ?? {};
    const lp = extract?.legalPerson ?? {};
    const executivesCurrent = mapPersonTimeline(cb?.statutoryBody).filter((x) => x.current);
    const stakeholdersCurrent = mapStakeholders(cb?.stakeholder).filter((x) => x.current);
    return {
        subject: {
            nameCurrent: currentName(cb?.corporateBodyFullName) ?? searchItem?.corporateBodyFullName ?? null,
            ico: normalizeIco(searchItem?.registrationNumber) ?? extractIcoFromLegalPerson(lp) ?? null,
            fileReference: searchItem?.fileReference?.formattedValueSpaced ??
                extract?.fileReference?.formattedValueSpaced ??
                null,
            courtName: extract?.courtName ?? null,
            legalForm: stringify(extract?.legalForm),
            dataSyncDate: stringify(extract?.dataSyncDate),
            addressCurrent: formatAddress(pickCurrent(lp?.physicalAddress)) ?? stringify(searchItem?.physicalAddress),
        },
        executivesCurrent,
        stakeholdersCurrent,
    };
}
function normalizeIco(value) {
    if (typeof value !== "string" && typeof value !== "number")
        return null;
    const cleaned = String(value).replace(/\s+/g, "").trim();
    return cleaned.length > 0 ? cleaned : null;
}
function extractIcoFromLegalPerson(lp) {
    const ids = Array.isArray(lp?.id) ? lp.id : [];
    for (const id of ids) {
        const itemCode = id?.identifierType?.item?.codelistItem?.itemCode;
        const itemName = id?.identifierType?.item?.codelistItem?.itemName ?? "";
        if (itemCode === "7" || /IČO|ICO/i.test(itemName)) {
            const value = normalizeIco(id?.identifierValue);
            if (value)
                return value;
        }
    }
    return null;
}
function mapSimpleHistory(items) {
    if (!Array.isArray(items)) {
        return [];
    }
    const out = items.map((item) => ({
        value: stringify(item?.value),
        od: toDateOrNull(item?.effectiveFrom),
        do: item?.effectiveToSpecified ? toDateOrNull(item?.effectiveTo) : null,
        current: Boolean(item?.current),
    }));
    return sortTimeline(out);
}
function mapPersonTimeline(items) {
    if (!Array.isArray(items)) {
        return [];
    }
    const out = items.map((item) => ({
        name: personOrCompanyName(item?.personData),
        function: stringify(item?.function),
        od: toDateOrNull(item?.effectiveFrom ?? item?.functionCreationDate),
        do: item?.effectiveToSpecified ? toDateOrNull(item?.effectiveTo ?? item?.functionTerminationDate) : null,
        current: Boolean(item?.current),
    }));
    return dedupeByKey(out, (x) => `${x.name}|${x.function}|${x.od}|${x.do}|${x.current}`);
}
function mapStakeholders(items) {
    if (!Array.isArray(items)) {
        return [];
    }
    const out = items.map((item) => ({
        type: stringify(item?.stakeholderType?.item?.codelistItem?.itemName),
        typeCode: stringify(item?.stakeholderType?.item?.codelistItem?.itemCode),
        name: personOrCompanyName(item?.personData),
        ico: extractIco(item?.personData?.id),
        od: toDateOrNull(item?.effectiveFrom ?? item?.functionCreationDate),
        do: item?.effectiveToSpecified ? toDateOrNull(item?.effectiveTo ?? item?.functionTerminationDate) : null,
        current: Boolean(item?.current),
    }));
    return dedupeByKey(out, (x) => `${x.type}|${x.name}|${x.ico}|${x.od}|${x.do}|${x.current}`);
}
function computeOwnershipFromDeposits(deposits) {
    const empty = [];
    if (!Array.isArray(deposits) || deposits.length === 0) {
        return {
            computedFromDeposits: empty,
            contributions: empty,
            not_beneficial_ownership: true,
            provenance: "current deposits contribution amounts",
            note: "V ORSR payloade nie su deposits[]; prispevky sa nedaju vypocitat.",
        };
    }
    const byCurrency = new Map();
    for (const dep of deposits) {
        if (!dep?.current) {
            continue;
        }
        const currency = stringify(dep?.currency?.item?.codelistItem?.itemName) ?? "UNKNOWN";
        const value = numberOrNull(dep?.depositPayedValue ?? dep?.depositValue);
        if (value === null) {
            continue;
        }
        const stakeholderNames = Array.isArray(dep?.stakeholder)
            ? dep.stakeholder.filter((s) => s?.current).map((s) => stringify(s?.value)).filter(Boolean)
            : [];
        for (const stakeholder of stakeholderNames) {
            if (!byCurrency.has(currency)) {
                byCurrency.set(currency, new Map());
            }
            const map = byCurrency.get(currency);
            map.set(stakeholder, (map.get(stakeholder) ?? 0) + value);
        }
    }
    const out = [];
    for (const [currency, map] of byCurrency.entries()) {
        const total = [...map.values()].reduce((acc, n) => acc + n, 0);
        for (const [stakeholder, value] of map.entries()) {
            out.push({
                stakeholder,
                currency: currency === "UNKNOWN" ? null : currency,
                value,
                percent: total > 0 ? round2((value / total) * 100) : null,
            });
        }
    }
    out.sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
    return {
        computedFromDeposits: out,
        contributions: out,
        not_beneficial_ownership: true,
        provenance: "current deposits contribution amounts",
        note: "Percenta su podiely na aktualnych prispevkoch, nie beneficial ownership. ORSR nemusi obsahovat uplne/priame percento vlastnictva.",
    };
}
function mapShares(shares) {
    if (!Array.isArray(shares)) {
        return [];
    }
    return shares.map((item) => ({
        shareType: stringify(item?.shareType?.item?.codelistItem?.itemName),
        shareForm: stringify(item?.shareForm),
        shareState: stringify(item?.shareState),
        sharesAmount: numberOrNull(item?.sharesAmount),
        shareNominalValue: numberOrNull(item?.shareNominalValue),
        transferability: stringify(item?.sharesTransferability),
        currency: stringify(item?.currency?.item?.codelistItem?.itemName),
        od: toDateOrNull(item?.effectiveFrom),
        do: item?.effectiveToSpecified ? toDateOrNull(item?.effectiveTo) : null,
        current: Boolean(item?.current),
    }));
}
function mapActingRules(items) {
    if (!Array.isArray(items)) {
        return [];
    }
    const out = items.map((item) => {
        const text = stringify(item?.value);
        return {
            od: toDateOrNull(item?.effectiveFrom),
            do: item?.effectiveToSpecified ? toDateOrNull(item?.effectiveTo) : null,
            current: Boolean(item?.current),
            mode: detectActingMode(text),
            text,
        };
    });
    return sortTimeline(out);
}
function detectActingMode(text) {
    if (!text) {
        return "nezname";
    }
    const t = normalizeText(text);
    const hasSolo = t.includes("samostatne");
    const hasJoint = t.includes("spolocne") || t.includes("spolocny") || t.includes("spolocne") || t.includes("spolu");
    if (hasSolo && hasJoint) {
        return "kombinovane";
    }
    if (hasSolo) {
        return "samostatne";
    }
    if (hasJoint) {
        return "spolocne";
    }
    return "nezname";
}
function mapAccountingStatements(documents) {
    if (!Array.isArray(documents)) {
        return [];
    }
    return documents
        .filter((doc) => includesInsensitive(normalizeText(stringify(doc?.name) ?? ""), "uctovna zavierka") || includesInsensitive(normalizeText(stringify(doc?.name) ?? ""), "schvalena uctovna zavierka"))
        .map((doc) => ({
        name: stringify(doc?.name),
        deliveryDate: toDateOrNull(doc?.deliveryDate),
        serialNumber: numberOrNull(doc?.serialNumber),
        pageCount: numberOrNull(doc?.pageCount),
        isElectronic: typeof doc?.isElectronic === "boolean" ? doc.isElectronic : null,
    }))
        .sort((a, b) => String(b.deliveryDate ?? "").localeCompare(String(a.deliveryDate ?? "")));
}
function mapLegalFactsMentions(otherLegalFacts) {
    if (!Array.isArray(otherLegalFacts)) {
        return [];
    }
    const keywords = ["zluc", "splyn", "fuz", "nastup", "predchod", "cezhranic"]; // normalized
    const out = [];
    for (const item of otherLegalFacts) {
        const text = stringify(item?.value);
        if (!text) {
            continue;
        }
        const normalized = normalizeText(text);
        if (keywords.some((k) => normalized.includes(k))) {
            out.push({ od: toDateOrNull(item?.effectiveFrom), text: truncate(text, 500) });
        }
    }
    return sortTimeline(out);
}
function currentName(names) {
    if (!Array.isArray(names)) {
        return null;
    }
    const current = names.find((n) => n?.current && typeof n?.value === "string");
    return stringify(current?.value) ?? stringify(names.find((n) => typeof n?.value === "string")?.value);
}
function pickCurrent(addresses) {
    if (!Array.isArray(addresses)) {
        return null;
    }
    return addresses.find((a) => a?.current) ?? addresses[0] ?? null;
}
function formatAddress(address) {
    if (!address || typeof address !== "object") {
        return null;
    }
    const street = [stringify(address?.streetName), stringify(address?.buildingNumber)].filter(Boolean).join(" ");
    const municipality = stringify(address?.municipality?.item);
    const postalCode = stringify(address?.deliveryAddress?.postalCode);
    const country = stringify(address?.country?.item);
    const parts = [
        street || null,
        [postalCode, municipality].filter(Boolean).join(" ").trim() || null,
        country || null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
}
function personOrCompanyName(personData) {
    const formatted = stringify(personData?.physicalPerson?.personName?.formattedName);
    if (formatted) {
        return formatted;
    }
    return stringify(personData?.corporateBody?.corporateBodyFullName);
}
function extractIco(ids) {
    if (!Array.isArray(ids)) {
        return null;
    }
    const ico = ids.find((id) => {
        const code = stringify(id?.identifierType?.item?.codelistItem?.itemCode);
        const name = normalizeText(stringify(id?.identifierType?.item?.codelistItem?.itemName) ?? "");
        return code === "7" || name.includes("ico");
    });
    return stringify(ico?.identifierValue);
}
function toDateOrNull(value) {
    const s = stringify(value);
    if (!s || s.startsWith("0001-01-01")) {
        return null;
    }
    return s;
}
function stringify(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return null;
}
function numberOrNull(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    return null;
}
function round2(value) {
    return Math.round(value * 100) / 100;
}
function normalizeText(value) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}
function includesInsensitive(haystack, needle) {
    return normalizeText(haystack).includes(normalizeText(needle));
}
function truncate(text, max) {
    return text.length <= max ? text : `${text.slice(0, max)}...`;
}
function dedupeByKey(items, keyFn) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const key = keyFn(item);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(item);
        }
    }
    return out;
}
function sortTimeline(items) {
    return [...items].sort((a, b) => String(a.od ?? "").localeCompare(String(b.od ?? "")));
}
