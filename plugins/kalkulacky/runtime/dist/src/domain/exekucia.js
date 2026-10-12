// Trovy exekucie (odmena exekutora + pausalne vydavky) podla vyhl. 68/2017 Z. z.
// Zdroj pravidiel: data/exekucia.json (overene zo Slov-Lex, viz "source"/"_comment" polia).
//
// Kluc rozdiely oproti povodnemu draftu (viz task-7-brief.md), zdokumentovane aj v
// data/exekucia.json._comment poliach:
//  - odmena NEMA zakonne minimum (penazne.min je null) — nikdy sa nedvvyha na "minimum"
//  - odmena je limitovana na 33 000 EUR (§ 9), nie na hranicu tarifneho pasma
//  - pri splneni naroku do uplynutia lehoty na podanie navrhu na zastavenie exekucie s
//    odkladnym ucinkom (§ 7 ods. 2, § 16 ods. 1, § 22 ods. 2) patri odmena len vo vyske
//    10 % a pausalne vydavky len vo vyske 50 %
//  - pausalne vydavky sa pocitaju z hodnoty platnej PRE OBDOBIE ZACATIA KONANIA
//    (pausalneVydavky.podlaObdobia), nie z aktualnej hodnoty — inak by starsie konania
//    dostali nespravnu (privysoku) sumu
//  - existuje aj samostatny limit odmeny podla § 197 ods. 1 zak. 233/1995 Z. z.
//    (Exekucny poriadok): odmena nesmie presiahnut vysku vymahaneho naroku ku dnu
//    vydania poverenia na vykonanie exekucie
//  - § 29 predpisuje dvojite zaokruhlovanie: zaklad na cele eura NAHOR, vypocitana
//    odmena na najblizsich 50 eurocentov NAHOR
//  - ak je exekutor platitelom DPH, DPH sa pripocitava k odmene AJ k pausalnym vydavkom
import { CalcError } from "./errors.js";
import { dateToUtc } from "./dates.js";
import { round2 } from "./money.js";
/** Zaokrúhli hodnotu nahor na najbližší násobok `step` (napr. 0,50 EUR podľa § 29). */
function roundUpToStep(value, step) {
    const steps = value / step;
    const roundedSteps = Math.ceil(steps - 1e-9);
    return round2(roundedSteps * step);
}
/**
 * Nájde obdobie z `podlaObdobia`, do ktorého patrí dátum začatia konania, a vráti
 * jeho `suma` spolu s hranicou `od` (tá je autoritatívna pre § 30b — nie text labelu).
 */
function pausalSumaProObdobie(podlaObdobia, zacatieKonania) {
    for (const obdobie of podlaObdobia) {
        const odOk = obdobie.zacatieKonaniaOd <= zacatieKonania;
        const doOk = obdobie.zacatieKonaniaDo === null || zacatieKonania <= obdobie.zacatieKonaniaDo;
        if (odOk && doOk) {
            return {
                suma: obdobie.suma,
                od: obdobie.zacatieKonaniaOd,
                label: `${obdobie.zacatieKonaniaOd}${obdobie.zacatieKonaniaDo ? ` - ${obdobie.zacatieKonaniaDo}` : ""}`,
            };
        }
    }
    throw new CalcError(`Pre dátum začatia konania "${zacatieKonania}" sa nenašlo žiadne obdobie v tabuľke paušálnych výdavkov.`, "NO_PAUSAL_PERIOD");
}
export function vypocitajTrovyExekucie(input, tables) {
    const { penazne, splnenieVLehote, zastavenie, pausalneVydavky, zaokruhlovanie, dph } = tables.exekucia;
    // Dátum začatia konania sa porovnáva lexikograficky s hranicami období — musí
    // byť overený ISO dátum, inak by zlý formát skončil až nejasnou NO_PAUSAL_PERIOD.
    dateToUtc(input.zacatieKonania);
    if (!Number.isFinite(input.vymozene)) {
        throw new CalcError("Vymožené plnenie musí byť konečné číslo.", "BAD_INPUT");
    }
    if (input.vymozene < 0) {
        throw new CalcError("Vymáhaný nárok (vymožené plnenie) nemôže byť záporný.", "NEGATIVE_CLAIM");
    }
    if (input.vymozene === 0 && !input.zastavene) {
        throw new CalcError("Vymáhaný nárok musí byť kladný — nulové vymožené plnenie je prípustné len pri zastavení exekúcie (zastavene: true).", "ZERO_CLAIM");
    }
    const platitelDph = input.platitelDph ?? false;
    const zastavene = input.zastavene ?? false;
    const splneneVLehote = input.splneneVLehote;
    const pravnyZaklad = ["§ 6 ods. 1 vyhl. 68/2017 Z. z.", zaokruhlovanie.pravnyZaklad];
    const warnings = [];
    // § 29: zaklad na urcenie odmeny sa zaokruhluje na cele eura nahor.
    const zakladOdmeny = Math.ceil(input.vymozene - 1e-9);
    // Sadzba odmeny: 20 % standardne (§ 7 ods. 1), 10 % pri splneni naroku v lehote (§ 7 ods. 2).
    const sadzba = splneneVLehote ? splnenieVLehote.sadzba : penazne.sadzba;
    pravnyZaklad.push(splneneVLehote ? "§ 7 ods. 2 vyhl. 68/2017 Z. z." : "§ 7 ods. 1 vyhl. 68/2017 Z. z.");
    // § 29: vypocitana odmena sa zaokruhluje na najblizsich 50 eurocentov nahor.
    const odmenaPredLimitom = roundUpToStep(zakladOdmeny * sadzba, 0.5);
    // § 9: celkova odmena pri exekucii na penazne plnenie nemoze presiahnut penazne.max (33 000 EUR).
    let odmena = odmenaPredLimitom;
    if (odmena > penazne.max) {
        odmena = penazne.max;
        pravnyZaklad.push("§ 9 vyhl. 68/2017 Z. z.");
        warnings.push(`Odmena pred limitom (${odmenaPredLimitom.toFixed(2)} EUR) presiahla zákonný strop § 9 (${penazne.max} EUR) — znížená na ${penazne.max} EUR.`);
    }
    // § 197 ods. 1 zak. 233/1995 Z. z.: odmena nesmie presiahnut vysku vymahaneho naroku
    // podla stavu ku dnu vydania poverenia na vykonanie exekucie.
    if (input.vymahanyNarokKuDnuPoverenia !== undefined) {
        pravnyZaklad.push("§ 197 ods. 1 zák. 233/1995 Z. z.");
        if (odmena > input.vymahanyNarokKuDnuPoverenia) {
            warnings.push(`Odmena (${odmena.toFixed(2)} EUR) presiahla vymáhaný nárok ku dňu vydania poverenia (§ 197 ods. 1 EP) — znížená na ${input.vymahanyNarokKuDnuPoverenia.toFixed(2)} EUR.`);
            odmena = input.vymahanyNarokKuDnuPoverenia;
        }
    }
    // Pausalne vydavky: zaklad podla obdobia zacatia konania (kanonicky zdroj podlaObdobia).
    const { suma: pausalneVydavkyZaklad, od: obdobieOd } = pausalSumaProObdobie(pausalneVydavky.podlaObdobia, input.zacatieKonania);
    // § 30b sa uplatní na konania začaté pred 1. 1. 2024 — rozhoduje dolná hranica
    // nájdeného obdobia z dát, nie text jeho labelu.
    const obdobiePred2024 = obdobieOd < "2024-01-01";
    if (obdobiePred2024) {
        pravnyZaklad.push("§ 30b vyhl. 68/2017 Z. z.");
        warnings.push(`Konanie začaté ${input.zacatieKonania} spadá do obdobia pred 1. 1. 2024 — paušálne výdavky (a pri splnení v lehote aj odmena) sa riadia predpismi účinnými do 31. 12. 2023 (§ 30b).`);
    }
    // Podiel pausalnych vydavkov: 1,0 standardne; 0,5 pri splneni naroku v lehote (§ 22 ods. 2);
    // 1,0 (plna nahrada) aj pri zastaveni exekucie (§ 21 ods. 2, § 22 ods. 1).
    let pausalneVydavkyPodiel;
    if (splneneVLehote) {
        pausalneVydavkyPodiel = splnenieVLehote.pausalneVydavkyPodiel;
        pravnyZaklad.push("§ 22 ods. 2 vyhl. 68/2017 Z. z.");
    }
    else if (zastavene) {
        pausalneVydavkyPodiel = zastavenie.penazne.pausalneVydavkyPodiel;
        pravnyZaklad.push("§ 21 ods. 2 vyhl. 68/2017 Z. z.", "§ 22 ods. 1 vyhl. 68/2017 Z. z.");
    }
    else {
        pausalneVydavkyPodiel = 1.0;
        pravnyZaklad.push("§ 22 ods. 1 vyhl. 68/2017 Z. z.");
    }
    const pausalneVydavkyVyska = round2(pausalneVydavkyZaklad * pausalneVydavkyPodiel);
    const zakladDph = round2(odmena + pausalneVydavkyVyska);
    let dphSuma = 0;
    let trovySpolu = zakladDph;
    if (platitelDph) {
        dphSuma = round2(zakladDph * dph.sadzba);
        trovySpolu = round2(zakladDph + dphSuma);
        pravnyZaklad.push("§ 197 ods. 2 zák. 233/1995 Z. z.", "§ 27 ods. 1 zák. 222/2004 Z. z.");
    }
    return {
        zakladOdmeny,
        odmenaPredLimitom,
        odmena,
        pausalneVydavkyZaklad,
        pausalneVydavkyPodiel,
        pausalneVydavky: pausalneVydavkyVyska,
        zakladDph,
        dph: dphSuma,
        trovySpolu,
        spolu: trovySpolu,
        pravnyZaklad,
        dataSnapshot: [tables.exekucia.snapshot],
        warnings,
    };
}
//# sourceMappingURL=exekucia.js.map