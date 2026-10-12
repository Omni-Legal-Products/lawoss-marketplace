import { CalcError } from "./errors.js";
import { round2 } from "./money.js";
/**
 * § 7 ods. 11: základ poplatku sa zaokrúhľuje na celé euro nadol.
 */
function roundZaklad(x) {
    return Math.floor(x + 1e-9);
}
/**
 * § 7a: vypočítaný poplatok sa zaokrúhľuje NADOL na najbližších 0,50 EUR —
 * t. j. desatinná časť < 50 centov sa zaokrúhli na celé euro nadol, presne
 * 50 centov sa nezaokrúhľuje, > 50 centov sa zaokrúhli na pol eura nadol.
 * Všetky tri prípady spolu zodpovedajú "floor na najbližších 0,50".
 */
function roundPoplatok(x) {
    const cents = Math.round(x * 100);
    const halfEuroCents = Math.floor((cents + 1e-6) / 50) * 50;
    return halfEuroCents / 100;
}
/**
 * § 6 ods. 5: zľava za e-podanie sa NEUPLATNÍ pri poplatkoch vyberaných v
 * exekučnom konaní ani vo veciach obchodného registra. Riadi sa explicitným
 * dátovým poľom `epodanieVylucene` (data/sudne-poplatky.json) — chýbajúce
 * pole znamená false (zľava sa uplatňuje bežne).
 */
function isEpodanieExcluded(polozka) {
    return polozka.epodanieVylucene === true;
}
export function zoznamPoloziek(tables) {
    return tables.poplatky.polozky.map((p) => ({ id: p.id, nazov: p.nazov }));
}
export function vypocitajSudnyPoplatok(input, tables) {
    const warnings = [];
    const pravnyZaklad = [];
    if (!input.polozkaId) {
        const ids = tables.poplatky.polozky.map((p) => p.id).join(", ");
        throw new CalcError(`Chýba polozkaId. Dostupné položky: ${ids}`, "MISSING_POLOZKA");
    }
    const polozka = tables.poplatky.polozky.find((p) => p.id === input.polozkaId);
    if (!polozka) {
        const ids = tables.poplatky.polozky.map((p) => p.id).join(", ");
        throw new CalcError(`Neznáma položka sadzobníka "${input.polozkaId}". Dostupné položky: ${ids}`, "UNKNOWN_POLOZKA");
    }
    pravnyZaklad.push(polozka.citacia);
    let uplatnene;
    let sadzbaRaw;
    let zaokruhlenyZaklad;
    if (polozka.vypocet.typ === "percento") {
        if (input.hodnotaSporu === undefined) {
            throw new CalcError(`Položka "${polozka.id}" (${polozka.nazov}) je percentuálna a vyžaduje hodnotu sporu (hodnotaSporu).`, "MISSING_HODNOTA_SPORU");
        }
        if (input.hodnotaSporu < 0) {
            throw new CalcError(`Hodnota sporu nesmie byť záporná (zadané ${input.hodnotaSporu}).`, "INVALID_INPUT");
        }
        pravnyZaklad.push(tables.poplatky.zaklad.zaklad);
        zaokruhlenyZaklad = roundZaklad(input.hodnotaSporu);
        const sadzbaPct = input.skoncenie === "zmier" && polozka.vypocet.sadzbaZmier !== undefined
            ? polozka.vypocet.sadzbaZmier
            : polozka.vypocet.sadzba;
        const vypocitane = sadzbaPct * zaokruhlenyZaklad;
        const min = polozka.vypocet.min;
        const maxBase = input.obchodnaVec && polozka.vypocet.maxObchodne !== undefined
            ? polozka.vypocet.maxObchodne
            : polozka.vypocet.max;
        if (min !== undefined && vypocitane < min) {
            sadzbaRaw = min;
            uplatnene = "min";
        }
        else if (maxBase !== undefined && vypocitane > maxBase) {
            sadzbaRaw = maxBase;
            uplatnene = "max";
        }
        else {
            sadzbaRaw = vypocitane;
            uplatnene = "sadzba";
        }
    }
    else {
        sadzbaRaw = polozka.vypocet.suma;
        uplatnene = "pevna";
    }
    pravnyZaklad.push(tables.poplatky.zaokruhleniePoplatku.zaklad);
    const sadzbaZoSadzobnika = roundPoplatok(sadzbaRaw);
    // Násobok inštancie (§ 6 ods. 2) alebo upomínacieho konania (§ 11c ods. 1).
    // Vzájomne sa vylučujú; upominacieKonanie má prednosť.
    let multiplier = 1;
    if (input.upominacieKonanie) {
        const rec = tables.poplatky.instancie["upominacieKonanie"];
        if (rec) {
            multiplier = rec.nasobok;
            pravnyZaklad.push(rec.zaklad);
        }
    }
    else if (input.instancia) {
        const key = input.instancia === "odvolanie" ? "odvolanieVoVeciSamej" : input.instancia;
        const rec = tables.poplatky.instancie[key];
        if (rec) {
            multiplier = rec.nasobok;
            pravnyZaklad.push(rec.zaklad);
        }
    }
    const sadzbaPoNasobku = sadzbaZoSadzobnika * multiplier;
    const zakladnyPoplatok = round2(sadzbaPoNasobku);
    // E-podanie (§ 6 ods. 3): zľava = max(0,5 × sadzba, sadzba − maxZlava).
    // Neuplatní sa v upomínacom konaní (§ 11c ods. 1) ani pri položkách
    // vylúčených podľa § 6 ods. 5 (exekučné konanie, obchodný register).
    const excluded = isEpodanieExcluded(polozka);
    const applyEpodanie = Boolean(input.epodanie) && !input.upominacieKonanie && !excluded;
    let poplatokRaw = sadzbaPoNasobku;
    let zlavaEpodanie = 0;
    if (applyEpodanie) {
        const { zlava, maxZlava, zaklad } = tables.poplatky.epodanie;
        poplatokRaw = Math.max(zlava * sadzbaPoNasobku, sadzbaPoNasobku - maxZlava);
        pravnyZaklad.push(zaklad);
    }
    else if (input.epodanie) {
        warnings.push(`Zľava za e-podanie sa na položku "${polozka.id}" neuplatňuje (§ 6 ods. 5, resp. § 11c ods. 1 zák. 71/1992 Zb.).`);
    }
    const poplatok = roundPoplatok(poplatokRaw);
    if (applyEpodanie) {
        zlavaEpodanie = round2(zakladnyPoplatok - poplatok);
    }
    if (input.upominacieKonanie) {
        warnings.push("Upomínacie konanie (§ 11c ods. 1): zákon výslovne nerieši, či sa minimum/maximum položky uplatní pred alebo po znížení sadzby na 50 %. Použitý výklad: najprv min/max podľa sadzobníka, potom zníženie na polovicu.");
    }
    return {
        polozka: { id: polozka.id, nazov: polozka.nazov, citacia: polozka.citacia },
        zakladnyPoplatok,
        zlavaEpodanie,
        poplatok,
        uplatnene,
        pravnyZaklad: [...new Set(pravnyZaklad)],
        dataSnapshot: [tables.poplatky.snapshot],
        warnings,
        ...(zaokruhlenyZaklad !== undefined ? { zaokruhlenyZaklad } : {}),
        sadzbaZoSadzobnika,
    };
}
//# sourceMappingURL=poplatky.js.map