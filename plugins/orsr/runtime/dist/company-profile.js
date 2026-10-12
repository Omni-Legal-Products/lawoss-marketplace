export const DATE_SEMANTICS = "od/do = obdobie platnosti zápisu v registri (dátum zápisu a výmazu), nie trvanie funkcie. " +
    "Trvanie funkcie či účasti je v functionCreationDate (vznik) a functionTerminationDate (skončenie); " +
    "null znamená, že register tento údaj neuvádza. registryDeletionRecord=true je výmazový záznam " +
    "(od je deň po výmaze, do deň výmazu), funkcia v ňom skončila k functionTerminationDate.";
export function buildCompanyProfile(searchItem, extractFull, documents) {
    const cb = extractFull?.legalPerson?.corporateBody ?? {};
    const lp = extractFull?.legalPerson ?? {};
    const statutoryAll = mapPersonTimeline(cb?.statutoryBody);
    const stakeholderAll = mapStakeholders(cb?.stakeholder);
    const ownership = computeOwnershipFromDeposits(cb?.deposits);
    const equity = mapEquity(cb?.equity);
    const predecessorEntities = stakeholderAll
        .filter((s) => includesInsensitive(s.typeCode ?? "", "predchod") || includesInsensitive(s.type ?? "", "predchod"))
        .map((s) => ({ name: s.name, ico: s.ico, od: s.od, do: s.do, current: s.current }));
    const legalFactsMentions = mapLegalFactsMentions(cb?.otherLegalFacts);
    return {
        subject: buildSubject(searchItem, extractFull),
        dateSemantics: DATE_SEMANTICS,
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
        equity: {
            current: equity.find((x) => x.current) ?? null,
            history: equity,
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
    const executivesCurrent = mapPersonTimeline(cb?.statutoryBody).filter((x) => x.current);
    const stakeholdersCurrent = mapStakeholders(cb?.stakeholder).filter((x) => x.current);
    return {
        subject: buildSubject(searchItem, extract),
        dateSemantics: DATE_SEMANTICS,
        equityCurrent: mapEquity(cb?.equity).find((x) => x.current) ?? null,
        executivesCurrent,
        stakeholdersCurrent,
    };
}
function buildSubject(searchItem, payload) {
    const cb = payload?.legalPerson?.corporateBody ?? {};
    const lp = payload?.legalPerson ?? {};
    const terminationDate = toDateOrNull(cb?.termination);
    const legalStatusEvents = mapLegalStatusEvents(cb?.legalStatusEvents);
    const terminated = terminationDate !== null || legalStatusEvents.some((e) => e.current && normalizeText(e.type ?? "") === "vymaz");
    const names = Array.isArray(cb?.corporateBodyFullName) ? cb.corporateBodyFullName : [];
    const addresses = Array.isArray(lp?.physicalAddress) ? lp.physicalAddress : [];
    // The search row only describes the subject as it was last registered, so it
    // may stand in for a current value of a live company, never of a deleted one.
    const searchName = terminated ? null : stringify(searchItem?.corporateBodyFullName);
    const searchAddress = terminated ? null : stringify(searchItem?.physicalAddress);
    return {
        nameCurrent: stringify(names.find((n) => n?.current)?.value) ?? searchName,
        nameLastRegistered: stringify(latestRecord(names)?.value) ?? stringify(searchItem?.corporateBodyFullName),
        ico: normalizeIco(searchItem?.registrationNumber) ?? extractIcoFromLegalPerson(lp) ?? null,
        fileReference: searchItem?.fileReference?.formattedValueSpaced ??
            payload?.fileReference?.formattedValueSpaced ??
            null,
        courtName: payload?.courtName ?? null,
        legalForm: stringify(payload?.legalForm),
        legalFormName: stringify((Array.isArray(cb?.legalForm) ? cb.legalForm.find((x) => x?.current) : null)?.item?.codelistItem?.itemName),
        dataSyncDate: stringify(payload?.dataSyncDate),
        addressCurrent: formatAddress(addresses.find((a) => a?.current)) ?? searchAddress,
        addressLastRegistered: formatAddress(latestRecord(addresses)),
        establishmentDate: toDateOrNull(cb?.establishment),
        terminated,
        terminationDate,
        inLiquidation: !terminated && legalStatusEvents.some((e) => e.current && normalizeText(e.type ?? "") === "likvidaciazaciatok"),
        legalStatus: stringify(cb?.legalStatus) ?? codelistLabel(cb?.legalStatus),
        legalStatusEvents,
    };
}
function mapLegalStatusEvents(items) {
    if (!Array.isArray(items)) {
        return [];
    }
    return items.map((item) => ({
        type: stringify(item?.type),
        date: toDateOrNull(item?.dateTime),
        text: stringify(item?.text),
        od: toDateOrNull(item?.effectiveFrom),
        current: Boolean(item?.current),
    }));
}
function mapEquity(items) {
    if (!Array.isArray(items)) {
        return [];
    }
    const out = items.map((item) => ({
        value: item?.equityValueSpecified === false ? null : numberOrNull(item?.equityValue),
        paid: item?.equityValuePaidSpecified === false ? null : numberOrNull(item?.equityValuePaid),
        currency: codelistLabel(item?.currency),
        od: toDateOrNull(item?.effectiveFrom),
        do: item?.effectiveToSpecified ? toDateOrNull(item?.effectiveTo) : null,
        current: Boolean(item?.current),
    }));
    return [...sortTimeline(out)].reverse();
}
/** Codelist values come either as a plain string ({item: "EUR"}) or nested ({item: {codelistItem: {itemName}}}). */
function codelistLabel(value) {
    return stringify(value?.item) ?? stringify(value?.item?.codelistItem?.itemName);
}
function latestRecord(items) {
    return [...items].sort((a, b) => String(b?.effectiveFrom ?? "").localeCompare(String(a?.effectiveFrom ?? "")))[0] ?? null;
}
function recordDates(item) {
    const od = toDateOrNull(item?.effectiveFrom);
    const doDate = item?.effectiveToSpecified ? toDateOrNull(item?.effectiveTo) : null;
    return {
        od,
        do: doDate,
        functionCreationDate: toDateOrNull(item?.functionCreationDate),
        functionTerminationDate: toDateOrNull(item?.functionTerminationDate),
        registryDeletionRecord: od !== null && doDate !== null && od > doDate,
        current: Boolean(item?.current),
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
        ...recordDates(item),
    }));
    return dedupeByKey(out, (x) => `${x.name}|${x.function}|${x.od}|${x.do}|${x.functionCreationDate}|${x.functionTerminationDate}|${x.current}`);
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
        ...recordDates(item),
    }));
    return dedupeByKey(out, (x) => `${x.type}|${x.name}|${x.ico}|${x.od}|${x.do}|${x.functionCreationDate}|${x.functionTerminationDate}|${x.current}`);
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
        const currency = codelistLabel(dep?.currency) ?? "UNKNOWN";
        // Percentages are shares of the subscribed contributions; mixing paid and
        // subscribed amounts across deposits would put them on different bases.
        const subscribed = numberOrNull(dep?.depositValue);
        const paid = numberOrNull(dep?.depositPayedValue);
        const value = subscribed ?? paid;
        if (value === null) {
            continue;
        }
        const stakeholderNames = Array.isArray(dep?.stakeholder)
            ? dep.stakeholder.filter((s) => s?.current).map((s) => stringify(s?.value)).filter(Boolean)
            : [];
        if (stakeholderNames.length === 0) {
            continue;
        }
        // A contribution held jointly is one holding, not one per co-owner —
        // crediting the full amount to each of them would exceed 100 %.
        const coOwned = stakeholderNames.length > 1;
        const holder = stakeholderNames.join("; ");
        if (!byCurrency.has(currency)) {
            byCurrency.set(currency, new Map());
        }
        const map = byCurrency.get(currency);
        const prev = map.get(holder);
        map.set(holder, {
            value: (prev?.value ?? 0) + value,
            paidValue: prev && prev.paidValue === null ? null : paid === null ? null : (prev?.paidValue ?? 0) + paid,
            coOwned,
        });
    }
    const out = [];
    for (const [currency, map] of byCurrency.entries()) {
        const total = [...map.values()].reduce((acc, n) => acc + n.value, 0);
        for (const [stakeholder, holding] of map.entries()) {
            out.push({
                stakeholder,
                currency: currency === "UNKNOWN" ? null : currency,
                value: holding.value,
                paidValue: holding.paidValue,
                coOwned: holding.coOwned,
                percent: total > 0 ? round2((holding.value / total) * 100) : null,
            });
        }
    }
    out.sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
    return {
        computedFromDeposits: out,
        contributions: out,
        not_beneficial_ownership: true,
        provenance: "current deposits contribution amounts",
        note: "Percenta su podiely na aktualnych upisanych vkladoch (value), nie beneficial ownership; splatena cast je v paidValue. " +
            "coOwned=true znamena jeden vklad v spoluvlastnictve uvedenych spolocnikov. ORSR nemusi obsahovat uplne/priame percento vlastnictva.",
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
        currency: codelistLabel(item?.currency),
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
            // Kept whole: the cut used to drop the successor and the deletion clause
            // that follow the notarial references in a merger fact.
            out.push({ od: toDateOrNull(item?.effectiveFrom), text });
        }
    }
    return sortTimeline(out);
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
