import { CalcError } from "./errors.js";
import { round2 } from "./money.js";
function vypoctovyZaklad(tables, rok) {
    const hodnota = tables.vypoctovyZaklad.years[String(rok)];
    if (hodnota === undefined) {
        throw new CalcError(`Výpočtový základ pre rok ${rok} nie je v tabuľke "vypoctovy-zaklad.json" k dispozícii.`, "MISSING_YEAR");
    }
    return hodnota;
}
function zakladnaSadzbaZTarifnejHodnoty(tables, h) {
    const pasma = tables.trovy.pasma;
    const pasmo = pasma.find((p) => h <= (p.do ?? Infinity));
    if (!pasmo) {
        throw new CalcError(`Pre tarifnú hodnotu ${h} sa nenašlo žiadne pásmo v § 10 ods. 1.`, "NO_PASMO");
    }
    let sadzba = pasmo.zaklad;
    if (pasmo.krok) {
        const presah = h - pasmo.krok.prevysujucichSumu;
        const kroky = Math.ceil(presah / pasmo.krok.za);
        sadzba += Math.max(kroky, 0) * pasmo.krok.suma;
    }
    return round2(sadzba);
}
/**
 * Sadzba DPH pre rok úkonu podľa `dphHistoria`. Ak rok leží pred pokrytím
 * tabuľky, NEHÁDA sa (predtým sa ticho použila aktuálna sadzba — pre úkon
 * z roku 2009 to znamenalo 23 % namiesto vtedajších 19 %). Doplnenie starších
 * sadzieb je možné len s overenou citáciou v `data/trovy.json`.
 */
function dphSadzbaZaRok(tables, rok) {
    const datum = `${rok}-01-01`;
    const historia = tables.trovy.dphHistoria;
    const zaznam = historia.find((z) => datum >= z.from && (z.to === null || datum <= z.to));
    if (!zaznam) {
        const najstarsi = historia.reduce((min, z) => (min === undefined || z.from < min ? z.from : min), undefined);
        throw new CalcError(`Sadzba DPH pre rok ${rok} nie je v tabuľke "trovy.json" (dphHistoria) k dispozícii — ` +
            `história začína ${najstarsi ?? "neznámym dátumom"} (1. 1. 2011). ` +
            `Pre starší úkon urč DPH manuálne podľa vtedajšieho znenia § 27 zák. 222/2004 Z. z. ` +
            `alebo výpočet spusti bez platitelDph.`, "DPH_RATE_UNKNOWN");
    }
    return zaznam.sadzba;
}
/**
 * Heuristika nad voliteľným textom `druh`: cestovné náhrady a náhradu za stratu
 * času (vyhl. 655/2004 Z. z.) v1 nepočíta. Ak takýto
 * riadok príde, ocení sa ako tarifný úkon — bez upozornenia by to bola ticho
 * nesprávna suma. Zámerne sa nematchuje samotné slovo "náhrada" (falošne by
 * chytilo napr. "žaloba o náhradu škody").
 */
const NAHRADA_RE = /cestovn|strat\w*\s*cas/;
function bezDiakritiky(s) {
    return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
export function vypocitajTrovy(input, tables) {
    const majuTarifnuHodnotu = input.tarifnaHodnota !== undefined && input.tarifnaHodnota !== null;
    const jeNevycislitelna = input.nevycislitelna === true;
    if (majuTarifnuHodnotu === jeNevycislitelna) {
        throw new CalcError('Musí byť zadané práve jedno z "tarifnaHodnota" / "nevycislitelna".', "INVALID_INPUT");
    }
    if (majuTarifnuHodnotu && input.tarifnaHodnota < 0) {
        throw new CalcError(`Tarifná hodnota nesmie byť záporná (zadané ${input.tarifnaHodnota}).`, "INVALID_INPUT");
    }
    if (input.ukony.length === 0) {
        throw new CalcError("Zoznam úkonov nesmie byť prázdny.", "INVALID_INPUT");
    }
    const pravnyZaklad = new Set();
    const warnings = [];
    const riadky = input.ukony.map((ukon) => {
        let zakladnaSadzba;
        if (majuTarifnuHodnotu) {
            zakladnaSadzba = zakladnaSadzbaZTarifnejHodnoty(tables, input.tarifnaHodnota);
            pravnyZaklad.add("§ 10 ods. 1 vyhl. 655/2004 Z. z.");
        }
        else {
            const vz = vypoctovyZaklad(tables, ukon.rok);
            zakladnaSadzba = round2(vz / 13);
            pravnyZaklad.add(tables.trovy.nevycislitelna.zaklad);
        }
        if (ukon.podiel !== 1 && ukon.podiel !== 0.5 && ukon.podiel !== 0.25) {
            warnings.push(`Úkon (rok ${ukon.rok}) má nezvyčajný podiel ${ukon.podiel} — očakáva sa 1 (plný), 0.5 (polovičný, § 13a ods. 2/4) alebo 0.25 (štvrtinový, § 13a ods. 4 druhá veta).`);
        }
        if (ukon.druh !== undefined && NAHRADA_RE.test(bezDiakritiky(ukon.druh))) {
            warnings.push(`Úkon "${ukon.druh}" vyzerá ako náhrada (cestovné/strata času) — v1 ich nepočíta, ` +
                `riadok je ocenený ako tarifný úkon.`);
        }
        if (ukon.podiel === 0.5)
            pravnyZaklad.add(tables.trovy.polovicneUkony.zaklad);
        if (ukon.podiel === 0.25)
            pravnyZaklad.add(tables.trovy.stvrtinoveUkony.zaklad);
        const odmena = round2(zakladnaSadzba * ukon.podiel);
        const vzPausal = vypoctovyZaklad(tables, ukon.rok);
        const pausal = round2(vzPausal / 100);
        pravnyZaklad.add(tables.trovy.rezijnyPausal.zaklad);
        const spolu = round2(odmena + pausal);
        return {
            rok: ukon.rok,
            podiel: ukon.podiel,
            ...(ukon.druh !== undefined ? { druh: ukon.druh } : {}),
            zakladnaSadzba,
            odmena,
            pausal,
            spolu,
        };
    });
    const zakladnaSadzba = riadky[0].zakladnaSadzba;
    const odmena = round2(riadky.reduce((sum, r) => sum + r.odmena, 0));
    const rezijnyPausal = round2(riadky.reduce((sum, r) => sum + r.pausal, 0));
    const zakladDph = round2(odmena + rezijnyPausal);
    let dph = 0;
    if (input.platitelDph) {
        dph = round2(riadky.reduce((sum, r) => sum + (r.odmena + r.pausal) * dphSadzbaZaRok(tables, r.rok), 0));
        pravnyZaklad.add(tables.trovy.dphZaklad);
    }
    const spoluBezDph = zakladDph;
    const spoluSDph = round2(spoluBezDph + dph);
    const spolu = input.platitelDph ? spoluSDph : spoluBezDph;
    return {
        riadky,
        zakladnaSadzba,
        odmena,
        rezijnyPausal,
        zakladDph,
        dph,
        spolu,
        spoluBezDph,
        spoluSDph,
        pravnyZaklad: [...pravnyZaklad],
        dataSnapshot: [tables.trovy.snapshot, tables.vypoctovyZaklad.snapshot],
        warnings,
    };
}
//# sourceMappingURL=trovy.js.map