// Úroky z omeškania (§ 517 ods. 2 OZ + nar. vl. 87/1995 Z. z.; § 369 ObZ + nar.
// vl. 21/2013 Z. z.). Čistá doména: žiadne fs, fetch ani MCP SDK — všetky
// zákonné parametre prichádzajú v `Tables` z data/loader.ts.
//
// Kľúčové konvencie (data/rezimy-urokov.json → dennyZakladVypoctu):
//  - omeškanie plynie od dňa nasledujúceho po splatnosti,
//  - ACT/365, deň platby sa ešte úročí z pôvodného zostatku (úhrada sa
//    započítava na konci dňa platby), úseky sú inklúzivne [od, do],
//  - zaokrúhľuje sa až finálna suma (round2), medzivýpočty nezaokrúhlené.
import { CalcError } from "./errors.js";
import { addDays, dateToUtc, daysBetween, halfYearStart, todayIso } from "./dates.js";
import { round2 } from "./money.js";
import { ecbRateAt } from "./types.js";
/**
 * Tabuľka ECB staršia než toľko dní voči dňu výpočtu (alebo dnešku) vyvolá
 * upozornenie. Produkčný refresh beží týždenne, repo PR tiež; 14 dní znamená
 * aspoň jeden zmeškaný refresh.
 */
export const STALE_ECB_DNI = 14;
/**
 * Upozornenie na vek tabuľky ECB (pre sadzby_info a štart servera), alebo null,
 * ak je tabuľka čerstvá. Nič nehovorí o správnosti konkrétneho výpočtu — to
 * rieši kontrola hľadaných dátumov vo `vypocitajUrok`.
 */
export function ecbVekUpozornenie(ecb, dnes) {
    const coverageTo = ecb.coverage.to;
    if (dnes <= coverageTo)
        return null;
    const vek = daysBetween(coverageTo, dnes);
    if (vek <= STALE_ECB_DNI)
        return null;
    return (`Tabuľka sadzieb ECB (${ecb.snapshot.file}, zdroj ${ecb.snapshot.zdroj}, verzia ${ecb.snapshot.version}) ` +
        `je overená len do ${coverageTo} — ${vek} dní dozadu (prah ${STALE_ECB_DNI} dní). Zmena sadzby ECB po tomto dni ` +
        `v nej nie je; spusti refresh sadzieb alebo over sadzbu na stránke ECB.`);
}
function halfYearEnd(iso) {
    const start = halfYearStart(iso);
    return start.endsWith("-01-01") ? `${start.slice(0, 4)}-06-30` : `${start.slice(0, 4)}-12-31`;
}
function fmt(x) {
    return x.toFixed(2).replace(".", ",");
}
/** Odsek predpisu z textu `zaklad` ("§ 3 ods. 2 …" → 2). */
function odsekZoZakladu(zaklad) {
    const m = /ods\.\s*(\d+)/.exec(zaklad);
    return m?.[1] ? Number(m[1]) : undefined;
}
/**
 * Zákonný (default) spôsob záznamu. Neopiera sa o poradie kľúčov v JSON (zod ho
 * negarantuje), ale o text `zaklad`: "zakonny zaklad" > "ods. 1" > jediný dostupný.
 */
function defaultSposob(z) {
    const dostupne = dostupneSposoby(z);
    const zakonny = dostupne.find(([, s]) => /zakonny zaklad/i.test(s.zaklad));
    if (zakonny)
        return zakonny[0];
    const ods1 = dostupne.find(([, s]) => odsekZoZakladu(s.zaklad) === 1);
    if (ods1)
        return ods1[0];
    const first = dostupne[0];
    if (!first)
        throw new CalcError("Záznam režimu neobsahuje žiadny spôsob výpočtu.", "DATA_INVALID");
    return first[0];
}
function dostupneSposoby(z) {
    const out = [];
    if (z.sposoby.fixny)
        out.push(["fixny", z.sposoby.fixny]);
    if (z.sposoby.variabilny)
        out.push(["variabilny", z.sposoby.variabilny]);
    return out;
}
/**
 * Výber záznamu podľa `vyberZaznamu` v data/rezimy-urokov.json: každá hranica
 * záznamu sa porovnáva s tou skutočnosťou, ktorú predpisuje `kriterium`
 * ("vznikOmeskania" alebo "vznikZavazku"). Naivné porovnanie jedného dátumu
 * s intervalom from/to je nesprávne.
 */
function vyberZaznam(zaznamy, rezim, vznikOmeskania, vznikZavazku, splatnost) {
    const warnings = [];
    // Záväzok nemôže vzniknúť po svojej splatnosti — ak dátum nie je zadaný,
    // splatnosť je najneskorší možný deň vzniku.
    const predpokladany = vznikZavazku ?? splatnost;
    // Hranice záznamov v jednom režime sú SEKVENČNÉ a komplementárne: horná
    // hranica záznamu i a dolná hranica záznamu i+1 opisujú tú istú hranicu z
    // dvoch strán (pozri `rozhodujucaSkutocnost` v dátach). Preto sa berie PRVÝ
    // záznam v poradí, ktorého obe hranice obstoja pri svojej vlastnej
    // skutočnosti; neskoršie záznamy implicitne predpokladajú, že hornú hranicu
    // predchádzajúceho záznamu vec prekročila.
    const vyber = (vznikZavazkuHodnota) => {
        const skutocnost = (ktora) => ktora === "vznikZavazku" ? vznikZavazkuHodnota : vznikOmeskania;
        return zaznamy.find((z) => {
            if (skutocnost(z.kriterium.from) < z.from)
                return false;
            if (z.to !== null && z.kriterium.to !== null && skutocnost(z.kriterium.to) > z.to)
                return false;
            return true;
        });
    };
    const zaznam = vyber(predpokladany);
    if (!zaznam) {
        throw new CalcError(`Pre režim "${rezim}" sa nepodarilo určiť právny režim úrokov (vznik omeškania ${vznikOmeskania}` +
            `${vznikZavazku ? `, vznik záväzku ${vznikZavazku}` : ""}).`, "REGIME_NOT_FOUND");
    }
    if (vznikZavazku === undefined) {
        // Ak by pri najskoršom možnom vzniku záväzku platil iný záznam, výber závisí
        // od nezadaného údaja — povieme to nahlas, nehádame potichu.
        const najskorsi = vyber(zaznamy[0]?.from ?? predpokladany);
        if (najskorsi !== undefined && najskorsi !== zaznam) {
            warnings.push(`Dátum vzniku záväzkového vzťahu (vznikZavazku) nebol zadaný. Režim bol určený z predpokladu, ` +
                `že záväzok vznikol najneskôr v deň splatnosti (${splatnost}); ak vznikol skôr — najmä pred 1. 2. 2013 — ` +
                `zadaj vznikZavazku, inak môže byť sadzba nesprávna (§ 10c nar. vl. 87/1995 Z. z.).`);
        }
    }
    return { zaznam, warnings };
}
function rozvrhSadzieb(sposob, sposobZ, tables, vznikOmeskania) {
    if (sposob === "fixny") {
        const ecb = ecbRateAt(tables.ecb.entries, vznikOmeskania);
        const sadzba = ecb + sposobZ.spread;
        const odvodenie = `ECB ${fmt(ecb)} % k prvému dňu omeškania (${vznikOmeskania}) + ${sposobZ.spread} p. b. = ${fmt(sadzba)} % p. a.`;
        return { sadzbaPre: () => ({ sadzba, do: null, odvodenie, ecbDatum: vznikOmeskania }) };
    }
    return {
        sadzbaPre: (iso) => {
            const start = halfYearStart(iso);
            const ecb = ecbRateAt(tables.ecb.entries, start);
            const sadzba = ecb + sposobZ.spread;
            return {
                sadzba,
                do: halfYearEnd(iso),
                ecbDatum: start,
                odvodenie: `ECB ${fmt(ecb)} % k prvému dňu polroka (${start}) + ${sposobZ.spread} p. b. = ${fmt(sadzba)} % p. a.`,
            };
        },
    };
}
function pocitaj(input, tables, vznikOmeskania, kuDnu, schedule, uhrady) {
    const useky = [];
    const uhradyZapocet = [];
    const warnings = [];
    let istina = input.istina;
    let urokSpolu = 0;
    let neuhradeny = 0;
    let naUrok = 0;
    let naIstinu = 0;
    let preplatok = 0;
    const platbyPodlaDna = new Map();
    for (const u of uhrady) {
        platbyPodlaDna.set(u.datum, (platbyPodlaDna.get(u.datum) ?? 0) + u.suma);
    }
    const dnyPlatieb = [...platbyPodlaDna.keys()].sort();
    const ecbDatumy = new Set();
    let koniecOmeskania = kuDnu;
    let cursor = vznikOmeskania;
    while (cursor <= kuDnu) {
        const { sadzba, do: hranica, odvodenie, ecbDatum } = schedule.sadzbaPre(cursor);
        if (ecbDatum !== null && istina > 0)
            ecbDatumy.add(ecbDatum);
        const dalsiaPlatba = dnyPlatieb.find((d) => d >= cursor);
        let konec = kuDnu;
        if (hranica !== null && hranica < konec)
            konec = hranica;
        if (dalsiaPlatba !== undefined && dalsiaPlatba < konec)
            konec = dalsiaPlatba;
        const dni = daysBetween(cursor, konec) + 1;
        if (istina > 0) {
            const urok = (istina * sadzba * dni) / (100 * 365);
            urokSpolu += urok;
            neuhradeny += urok;
            useky.push({
                od: cursor,
                do: konec,
                dni,
                sadzba,
                zaklad: round2(istina),
                urok: round2(urok),
                odvodenie: `${odvodenie}; ${fmt(istina)} € × ${fmt(sadzba)} % × ${dni}/365 = ${fmt(urok)} €`,
            });
        }
        const platba = platbyPodlaDna.get(konec);
        if (platba !== undefined) {
            let zostatok = platba;
            let sumaNaUrok = 0;
            let sumaNaIstinu = 0;
            const naUrokKrok = () => {
                const x = Math.min(zostatok, neuhradeny);
                sumaNaUrok += x;
                neuhradeny -= x;
                zostatok -= x;
            };
            const naIstinuKrok = () => {
                const x = Math.min(zostatok, istina);
                sumaNaIstinu += x;
                istina -= x;
                zostatok -= x;
            };
            if (input.uhradyNajprvIstina) {
                naIstinuKrok();
                naUrokKrok();
            }
            else {
                naUrokKrok();
                naIstinuKrok();
            }
            naUrok += sumaNaUrok;
            naIstinu += sumaNaIstinu;
            if (zostatok > 0) {
                preplatok += zostatok;
                warnings.push(`Úhrady prevyšujú dlh o ${fmt(preplatok)} € k dátumu ${konec}.`);
            }
            if (istina <= 0 && koniecOmeskania === kuDnu)
                koniecOmeskania = konec;
            uhradyZapocet.push({
                datum: konec,
                suma: round2(platba),
                naUrok: round2(sumaNaUrok),
                naIstinu: round2(sumaNaIstinu),
                preplatok: round2(zostatok),
                zostatokIstiny: round2(istina),
            });
        }
        if (istina <= 0 && dnyPlatieb.every((d) => d <= konec))
            break;
        cursor = addDays(konec, 1);
    }
    return {
        useky,
        uhradyZapocet,
        urokSpoluRaw: urokSpolu,
        neuhradenyUrokRaw: Math.max(0, neuhradeny),
        istinaRaw: Math.max(0, istina),
        naUrokRaw: naUrok,
        naIstinuRaw: naIstinu,
        preplatokRaw: preplatok,
        ecbDatumy: [...ecbDatumy],
        koniecOmeskania,
        warnings,
    };
}
/**
 * Či sa základná úroková sadzba ECB zmenila počas omeškania: existuje zmena
 * účinná po prvom dni omeškania a najneskôr v posledný deň omeškania. Zmena
 * účinná práve v prvý deň omeškania sa nepočíta — tá je už v sadzbe „platnej
 * k prvému dňu omeškania“.
 */
function zmenilaSaEcbPocasOmeskania(tables, vznikOmeskania, koniec) {
    return tables.ecb.entries.some((e) => e.from > vznikOmeskania && e.from <= koniec);
}
/**
 * Vypočíta úroky z omeškania vrátane započítania úhrad.
 *
 * @param dnes fallback pre `input.kuDnu` (default `todayIso()`).
 */
export function vypocitajUrok(input, tables, dnes) {
    if (!(input.istina > 0)) {
        throw new CalcError("Istina musí byť väčšia ako 0.", "BAD_INPUT");
    }
    const kuDnu = input.kuDnu ?? dnes ?? todayIso();
    const vznikOmeskania = addDays(input.splatnost, 1);
    if (input.splatnost < tables.rezimy.coverageFrom) {
        throw new CalcError(`Splatnosť ${input.splatnost} je pred pokrytím dátovej tabuľky (${tables.rezimy.coverageFrom}). ` +
            `Kalkulačka v1 nepokrýva režim dvojnásobku diskontnej sadzby NBS platný do 31. 12. 2008 — ` +
            `pre takéto pohľadávky treba úrok vypočítať podľa vtedajších predpisov.`, "BEFORE_COVERAGE");
    }
    if (kuDnu < input.splatnost) {
        throw new CalcError(`Deň výpočtu (${kuDnu}) je pred splatnosťou (${input.splatnost}).`, "BAD_INPUT");
    }
    // Výber právneho režimu sa robí lexikografickým porovnaním dátumov, takže
    // vznikZavazku musí byť overený ISO dátum — inak by napr. "15.03.2015"
    // ticho spadlo pod hranicu 2013-01-31 a vrátilo nesprávnu sadzbu.
    if (input.vznikZavazku !== undefined) {
        dateToUtc(input.vznikZavazku);
        if (input.vznikZavazku > input.splatnost) {
            throw new CalcError(`Vznik záväzku (${input.vznikZavazku}) je po splatnosti (${input.splatnost}) — ` +
                `záväzok nemôže vzniknúť po svojej splatnosti.`, "BAD_INPUT");
        }
    }
    const uhrady = [...(input.uhrady ?? [])].sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
    for (const u of uhrady) {
        if (!(u.suma > 0))
            throw new CalcError(`Úhrada k ${u.datum} musí byť väčšia ako 0.`, "BAD_INPUT");
        if (u.datum <= input.splatnost) {
            throw new CalcError(`Úhrada k ${u.datum} je v deň splatnosti (${input.splatnost}) alebo pred ním — pred týmto dňom omeškanie nevzniklo.`, "PAYMENT_BEFORE_DUE");
        }
        if (u.datum > kuDnu) {
            throw new CalcError(`Úhrada k ${u.datum} je po dni výpočtu (${kuDnu}).`, "PAYMENT_AFTER_KU_DNU");
        }
    }
    const warnings = [];
    const zaznamy = tables.rezimy[input.rezim];
    const vyber = vyberZaznam(zaznamy, input.rezim, vznikOmeskania, input.vznikZavazku, input.splatnost);
    const zaznam = vyber.zaznam;
    warnings.push(...vyber.warnings);
    const pouzityZaznam = { rezim: input.rezim, from: zaznam.from, to: zaznam.to };
    const pravnyZaklad = [zaznam.zaklad];
    const dataSnapshot = [tables.rezimy.snapshot];
    // --- dohodnutá sadzba prebíja zákonnú (§ 369 ods. 1 ObZ) ---
    if (input.dohodnutaSadzba !== undefined) {
        if (!(input.dohodnutaSadzba >= 0)) {
            throw new CalcError("Dohodnutá sadzba nesmie byť záporná.", "BAD_INPUT");
        }
        const sadzba = input.dohodnutaSadzba;
        const schedule = {
            sadzbaPre: () => ({ sadzba, do: null, odvodenie: `Dohodnutá sadzba ${fmt(sadzba)} % p. a.`, ecbDatum: null }),
        };
        const v = pocitaj(input, tables, vznikOmeskania, kuDnu, schedule, uhrady);
        pravnyZaklad.push("Dohodnutá sadzba úrokov z omeškania prebíja zákonnú (§ 369 ods. 1 ObZ; § 517 ods. 2 OZ pre občianskoprávne vzťahy).");
        return zabal(v, {
            pouzitySposob: "dohodnuta",
            pouzityZaznam,
            alternativy: [],
            uplatnitelny: true,
            pravnyZaklad,
            dataSnapshot,
            warnings: [...warnings, ...v.warnings],
            kuDnu,
            tables,
            pouzilaSaEcb: false,
            ecbDatumy: [],
        });
    }
    // --- zákonná sadzba ---
    const dostupne = dostupneSposoby(zaznam);
    const volba = input.sposob ?? defaultSposob(zaznam);
    const variantList = volba === "najvyhodnejsi" ? dostupne : dostupne.filter(([s]) => s === volba);
    if (variantList.length === 0) {
        throw new CalcError(`Spôsob "${volba}" nie je pre režim "${input.rezim}" v období od ${zaznam.from} prípustný ` +
            `(dostupné: ${dostupne.map(([s]) => s).join(", ")}).`, "SPOSOB_NOT_AVAILABLE");
    }
    const ecbDatumy = new Set();
    const spocitane = variantList.map(([s, sz]) => {
        const v = pocitaj(input, tables, vznikOmeskania, kuDnu, rozvrhSadzieb(s, sz, tables, vznikOmeskania), uhrady);
        v.ecbDatumy.forEach((d) => ecbDatumy.add(d));
        // § 3 ods. 2 nar. vl. 87/1995 Z. z. v znení do 31. 1. 2013: spôsob je
        // prípustný len „ak sa počas trvania omeškania zmení základná úroková sadzba
        // ECB“ — dáta to označujú príznakom vyzadujeZmenuSadzbyEcb.
        let podmienkaZmenyEcbSplnena;
        if (sz.vyzadujeZmenuSadzbyEcb === true) {
            podmienkaZmenyEcbSplnena = zmenilaSaEcbPocasOmeskania(tables, vznikOmeskania, v.koniecOmeskania);
            // Bez pokrytia do konca omeškania sa „nezmenila“ nedá tvrdiť — dátum ide do kontroly pokrytia.
            ecbDatumy.add(v.koniecOmeskania);
        }
        const odsek = odsekZoZakladu(sz.zaklad);
        return {
            sposob: s,
            sposobZ: sz,
            vypocet: v,
            podmienkaZmenyEcbSplnena,
            alternativa: {
                sposob: s,
                ...(odsek !== undefined ? { odsek } : {}),
                urokSpolu: round2(v.urokSpoluRaw),
                podmieneny: sz.podmienka !== undefined,
                ...(podmienkaZmenyEcbSplnena !== undefined ? { podmienkaZmenyEcbSplnena } : {}),
                zaklad: sz.zaklad,
            },
        };
    });
    const nezmenenaEcb = (k) => `Spôsob "${k.sposob}" (${k.sposobZ.zaklad}) je prípustný len ak sa počas trvania omeškania zmenila základná ` +
        `úroková sadzba ECB (${k.sposobZ.podmienka ?? "podmienka podľa dát"}). Medzi ${vznikOmeskania} a ` +
        `${k.vypocet.koniecOmeskania} sa sadzba ECB podľa tabuľky nezmenila`;
    // Pri "najvyhodnejsi" sa uplatní maximum z PRÍPUSTNÝCH spôsobov (podmienka
    // "…ak je to pre veriteľa výhodnejšie"); podmienený spôsob nikdy nevyhrá pri
    // rovnosti a spôsob bez zmeny ECB sa do výberu nedostane vôbec.
    const pripustne = spocitane.filter((k) => k.podmienkaZmenyEcbSplnena !== false);
    let vybrany = pripustne[0] ?? spocitane[0];
    if (volba === "najvyhodnejsi") {
        for (const kandidat of pripustne) {
            if (kandidat.vypocet.urokSpoluRaw > vybrany.vypocet.urokSpoluRaw)
                vybrany = kandidat;
        }
        for (const vylucene of spocitane.filter((k) => k.podmienkaZmenyEcbSplnena === false)) {
            if (vylucene.vypocet.urokSpoluRaw > vybrany.vypocet.urokSpoluRaw) {
                warnings.push(`${nezmenenaEcb(vylucene)} — preto sa neuplatní, hoci by dal vyšší úrok ` +
                    `(${fmt(vylucene.vypocet.urokSpoluRaw)} €); je v alternativy len ilustračne.`);
            }
        }
    }
    let uplatnitelny = true;
    // Výslovne vyžiadaný spôsob bez zmeny ECB počas omeškania nie je uplatniteľný.
    if (volba !== "najvyhodnejsi" && vybrany.podmienkaZmenyEcbSplnena === false) {
        uplatnitelny = false;
        warnings.push(`${nezmenenaEcb(vybrany)} — uplatniteľný je iný spôsob. Tento výsledok je len ilustračný.`);
    }
    // Ak si užívateľ výslovne vyžiadal podmienený spôsob, ktorý pre neho nie je
    // výhodnejší, výsledok je len výpočtová vetva — nie uplatniteľná suma.
    if (uplatnitelny && volba !== "najvyhodnejsi" && vybrany.sposobZ.podmienka !== undefined) {
        const iny = dostupne
            .filter(([s]) => s !== vybrany.sposob)
            .map(([s, sz]) => pocitaj(input, tables, vznikOmeskania, kuDnu, rozvrhSadzieb(s, sz, tables, vznikOmeskania), uhrady)
            .urokSpoluRaw);
        const najlepsiIny = iny.length > 0 ? Math.max(...iny) : -Infinity;
        if (vybrany.vypocet.urokSpoluRaw <= najlepsiIny) {
            uplatnitelny = false;
            warnings.push(`Spôsob "${vybrany.sposob}" (${vybrany.sposobZ.zaklad}) je prípustný len ak je pre veriteľa výhodnejší ` +
                `(${vybrany.sposobZ.podmienka}). Vypočítaný úrok ${fmt(vybrany.vypocet.urokSpoluRaw)} € nie je vyšší než ` +
                `${fmt(najlepsiIny)} € podľa druhého spôsobu — uplatniteľný je ten druhý výpočet. Tento výsledok je len ilustračný.`);
        }
    }
    pravnyZaklad.push(vybrany.sposobZ.zaklad);
    pravnyZaklad.push(`Konvencia výpočtu: ${tables.rezimy.dennyZakladVypoctu.konvencia}, úrok plynie od ${tables.rezimy.dennyZakladVypoctu.urokPlynieOd}.`);
    const odsek = odsekZoZakladu(vybrany.sposobZ.zaklad);
    return zabal(vybrany.vypocet, {
        pouzitySposob: vybrany.sposob,
        ...(odsek !== undefined ? { pouzityOdsek: odsek } : {}),
        pouzityZaznam,
        alternativy: spocitane.map((s) => s.alternativa),
        uplatnitelny,
        pravnyZaklad,
        dataSnapshot,
        warnings: [...warnings, ...vybrany.vypocet.warnings],
        kuDnu,
        tables,
        pouzilaSaEcb: true,
        ecbDatumy: [...ecbDatumy],
    });
}
function zabal(v, o) {
    const warnings = [...o.warnings];
    const dataSnapshot = [...o.dataSnapshot];
    if (o.pouzilaSaEcb) {
        dataSnapshot.push(o.tables.ecb.snapshot);
        const coverageTo = o.tables.ecb.coverage.to;
        const zaPokrytim = [...new Set(o.ecbDatumy)].filter((d) => d > coverageTo).sort();
        if (zaPokrytim.length > 0) {
            // Sadzba sa hľadala k dňu, pre ktorý tabuľka nič nevie — ecbRateAt vrátil
            // poslednú známu sadzbu, ktorá už nemusí platiť. Nezáleží na tom, o koľko dní.
            warnings.push(`Sadzba ECB sa určovala k ${zaPokrytim.join(", ")}, ale tabuľka sadzieb ECB ` +
                `(zdroj ${o.tables.ecb.snapshot.zdroj}, verzia ${o.tables.ecb.snapshot.version}) pokrýva dáta len do ${coverageTo}. ` +
                `Použila sa posledná známa sadzba; ak sa sadzba ECB po ${coverageTo} zmenila, výsledok je nesprávny. ` +
                `Over aktuálnu základnú úrokovú sadzbu ECB.`);
        }
        else if (o.kuDnu > coverageTo && daysBetween(coverageTo, o.kuDnu) > STALE_ECB_DNI) {
            warnings.push(`Tabuľka sadzieb ECB pokrýva dáta len do ${coverageTo}, počítalo sa ku ${o.kuDnu} ` +
                `(viac než ${STALE_ECB_DNI} dní). Over aktuálnu základnú úrokovú sadzbu ECB.`);
        }
    }
    const zostatokIstiny = round2(v.istinaRaw);
    const neuhradenyUrok = round2(v.neuhradenyUrokRaw);
    return {
        useky: v.useky,
        uhradyZapocet: v.uhradyZapocet,
        zostatokIstiny,
        urokSpolu: round2(v.urokSpoluRaw),
        neuhradenyUrok,
        celkomKuDnu: round2(v.istinaRaw + v.neuhradenyUrokRaw),
        uhradeneNaUrok: round2(v.naUrokRaw),
        uhradeneNaIstinu: round2(v.naIstinuRaw),
        preplatok: round2(v.preplatokRaw),
        pouzitySposob: o.pouzitySposob,
        ...(o.pouzityOdsek !== undefined ? { pouzityOdsek: o.pouzityOdsek } : {}),
        pouzityZaznam: o.pouzityZaznam,
        alternativy: o.alternativy,
        uplatnitelny: o.uplatnitelny,
        pravnyZaklad: o.pravnyZaklad,
        dataSnapshot,
        warnings,
    };
}
//# sourceMappingURL=urok.js.map