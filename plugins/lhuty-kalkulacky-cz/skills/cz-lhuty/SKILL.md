---
name: cz-lhuty
description: Deterministický výpočet procesních a hmotněprávních lhůt podle českého práva, včetně fikce doručení, posunu konce lhůty a odlišné aritmetiky daňového řádu. Použij vždy, když má agent určit poslední den lhůty v české věci. Výsledek je návrh k ověření advokátem. Plugin obsahuje jen skill, bez MCP.
---

Tento plugin nepřipojuje MCP, neobsahuje runtime ani přihlašovací údaje.
Výpočet provede agent spuštěním kódu v JavaScriptu níže. Datum nikdy
neodhaduj v hlavě.

# Lhůty podle českého práva

## Zásady

1. **Výpočet je kalendářní aritmetika, ne úsudek modelu.** Spusť kód níže
   postupem z oddílu „Spuštění“. Datum ani den v týdnu nepočítej z hlavy.
   Když kód spustit nelze, výpočet odmítni, řekni to uživateli a žádné
   datum neuváděj.
2. **Jurisdikce je povinná.** Tento skill platí jen pro ČR. Slovenská úprava
   se liší. Například stížnost podle § 143 odst. 1 tr. ř. jsou 3 kalendářní
   dny, kdežto podle slovenského trestního poriadku 3 pracovní dny.
3. **Předpis určuje aritmetiku, ne jen délku.** Vždy urči režim počítání
   (`osr` nebo `dr`).
4. **Fikce doručení je samostatný výpočet.** Nejdřív urči datum doručení,
   teprve od něj počítej navazující lhůtu.
5. **Zachování lhůty není totéž co její konec.** Uveď, zda stačí podání
   odeslat, nebo zda musí soudu dojít.
6. **Lhůty podle hodin nepočítej po dnech.** Odmítni je a vrať je člověku.
7. Každé použité ustanovení před citací ověř skillem `cz-predpisy-esbirka`
   ve znění účinném k rozhodnému dni.
8. Výstup vždy označ jako návrh k ověření advokátem. U pochybnosti o
   počátku lhůty uveď obě varianty a doporuč tu dřívější.

## Pravidla (znění ověřeno v e-Sbírce 22. 10. 2026)

| Režim | Pravidlo | Ustanovení |
|---|---|---|
| `osr` | Nezapočítává se den rozhodné skutečnosti. Lhůta podle týdnů, měsíců a let končí dnem shodného označení se dnem rozhodné skutečnosti, jinak posledním dnem měsíce. | § 57 odst. 1 a 2 o. s. ř., obdobně tr. ř., s. ř. s., spr. ř. |
| `osr` | Hmotněprávní lhůty a doby se počítají stejně. | § 605 o. z. |
| `dr` | Lhůta podle týdnů, měsíců a let **končí dnem shodným se dnem, kdy započal běh**, tedy o den později než podle o. s. ř. U lhůt podle dní rozdíl není. | § 33 odst. 1 a 2 daňového řádu |
| oba | Připadne-li konec na sobotu, neděli nebo svátek, posouvá se na nejbližší pracovní den. Svátky a dny volna uvnitř běhu lhůty se započítávají. | § 57 odst. 2 o. s. ř., § 607 o. z., § 33 odst. 4 d. ř. |
| oba | Svátky: 1. 1., Velký pátek, Velikonoční pondělí, 1. 5., 8. 5., 5. 7., 6. 7., 28. 9., 28. 10., 17. 11., 24. až 26. 12. | § 1 a § 2 zák. č. 245/2000 Sb. |

Velký pátek je svátkem až od roku 2016. Pro starší data použij znění
zákona o svátcích k rozhodnému dni.

## Fikce doručení

Do datové schránky: nepřihlásí-li se oprávněná osoba do 10 dnů od dodání,
dokument je doručen posledním dnem této lhůty (§ 17 odst. 4 zák. č.
300/2008 Sb.). Poštou do vlastních rukou: nevyzvedne-li si adresát
písemnost do 10 dnů od připravení k vyzvednutí, je doručena posledním dnem
této lhůty (§ 49 odst. 4 o. s. ř.).

Konec desetidenní úložní doby se **také posouvá** na pracovní den. Vychází
to z bodu [86] rozsudku rozšířeného senátu NSS ze dne 26. 5. 2022, č. j.
4 Afs 264/2018-85, který navazuje na stanovisko pléna NS sp. zn. Plsn 1/2015.
Úřední právní věta rozsudku je užší než bod [86]. Před citací v podání oba
texty ověř skillem `cz-judikatura`.

Pozor na výjimky: náhradní doručení může být vyloučeno zákonem nebo
pokynem předsedy senátu (§ 49 odst. 5 o. s. ř.).

## Spuštění

Kód je čistý JavaScript bez `require`, `import`, `process` a bez přístupu
k síti. Data přijímá i vrací jako text `"RRRR-MM-DD"` a počítá v UTC, takže
výsledek neovlivní časové pásmo ani letní čas.

- **LAWOSS:** zavolej nástroj `execute`. Do pole s kódem vlož celý blok
  níže beze změny a na konec připiš řádek s `return`. Python ani shell
  v LAWOSS nejsou k dispozici, nezkoušej je.
- **Jiné prostředí:** spusť týž blok v Node.js nebo jiném běhovém prostředí
  JavaScriptu. Logiku nepřepisuj do jiného jazyka.

Každé `execute` začíná s prázdným stavem, proto v každém volání vlož celý
blok znovu a nejdřív zavolej `kontrola()`. Ta vyhodí chybu, pokud některý
kontrolní případ nesedí. Příklad posledního řádku:

```text
kontrola(); return cesky(konec("2026-11-13", 15, "dny"));
```

Výsledek je `"pondělí 30. 11. 2026"`. Den v týdnu do odpovědi přeber
z výstupu `cesky()`, nedopočítávej ho. Více lhůt vrať najednou jako
objekt, například `return { odvolani: cesky(konec(d, 15, "dny")), ... }`.

## Kód

```js
const DEN_MS = 86400000;

function datum(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new Error(`Neplatné datum "${text}", čekám RRRR-MM-DD.`);
  }
  return d;
}

const text = (d) => d.toISOString().slice(0, 10);
const plusDny = (d, n) => new Date(d.getTime() + n * DEN_MS);

function velikonoce(rok) { // algoritmus Meeus/Jones/Butcher, gregoriánský kalendář
  const a = rok % 19, b = Math.floor(rok / 100), c = rok % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451), x = h + l - 7 * m + 114;
  return new Date(Date.UTC(rok, Math.floor(x / 31) - 1, (x % 31) + 1));
}

function svatky(rok) { // § 1 a § 2 zák. č. 245/2000 Sb.
  const v = velikonoce(rok);
  const s = new Set([[1, 1], [5, 1], [5, 8], [7, 5], [7, 6], [9, 28], [10, 28], [11, 17], [12, 24], [12, 25], [12, 26]]
    .map(([m, d]) => text(new Date(Date.UTC(rok, m - 1, d)))));
  s.add(text(plusDny(v, 1)));               // Velikonoční pondělí
  if (rok >= 2016) s.add(text(plusDny(v, -2))); // Velký pátek
  return s;
}

function posun(d) {
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || svatky(d.getUTCFullYear()).has(text(d))) d = plusDny(d, 1);
  return d;
}

function plusMesice(d, n) {
  const m = d.getUTCMonth() + n, rok = d.getUTCFullYear() + Math.floor(m / 12), mesic = m % 12;
  const posledni = new Date(Date.UTC(rok, mesic + 1, 0)).getUTCDate();
  return new Date(Date.UTC(rok, mesic, Math.min(d.getUTCDate(), posledni)));
}

// udalost: den rozhodné skutečnosti "RRRR-MM-DD"; jednotka: dny | tydny | mesice | roky;
// rezim: osr (o. s. ř., tr. ř., s. ř. s., spr. ř., o. z.) nebo dr (§ 33 d. ř.).
function konec(udalost, pocet, jednotka, rezim = "osr") {
  const u = datum(udalost);
  if (!Number.isInteger(pocet) || pocet < 0) throw new Error(`Neplatný počet "${pocet}".`);
  if (rezim !== "osr" && rezim !== "dr") throw new Error(`Neznámý režim "${rezim}", čekám osr nebo dr.`);
  if (jednotka === "dny") return text(posun(plusDny(u, pocet)));
  const z = rezim === "dr" ? plusDny(u, 1) : u;
  if (jednotka === "tydny") return text(posun(plusDny(z, 7 * pocet)));
  if (jednotka === "mesice") return text(posun(plusMesice(z, pocet)));
  if (jednotka === "roky") return text(posun(plusMesice(z, 12 * pocet)));
  throw new Error(`Neznámá jednotka "${jednotka}", čekám dny, tydny, mesice nebo roky.`);
}

function fikce(dodani) { // DS i pošta: konec desetidenní úložní doby s posunem
  return text(posun(plusDny(datum(dodani), 10)));
}

const DNY_V_TYDNU = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];

function cesky(iso) {
  const d = datum(iso);
  return `${DNY_V_TYDNU[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`;
}

const KONTROLNI_PRIPADY = [
  [() => konec("2026-12-15", 15, "dny"), "2026-12-30", "svátky uvnitř běhu se počítají"],
  [() => konec("2026-04-30", 1, "dny"), "2026-05-04", "svátek 1. 5. a víkend za sebou"],
  [() => konec("2026-03-05", 3, "dny"), "2026-03-09", "stížnost v tr. ř., posun z neděle"],
  [() => konec("2026-03-31", 3, "mesice"), "2026-06-30", "konec měsíce podle o. s. ř."],
  [() => konec("2026-03-31", 3, "mesice", "dr"), "2026-07-01", "daňový řád, o den později"],
  [() => konec("2026-03-02", 2, "mesice"), "2026-05-04", "přihláška pohledávky, posun ze soboty"],
  [() => konec(fikce("2026-04-23"), 15, "dny"), "2026-05-19", "úložní doba končí v neděli"],
  [() => konec(fikce("2026-04-21"), 15, "dny"), "2026-05-19", "úložní doba končí na svátek 1. 5."],
  [() => konec("2026-11-13", 15, "dny"), "2026-11-30", "doručení v pátek, konec v pondělí, ne 1. 12."],
];

function kontrola() {
  for (const [vypocet, ocekavano, popis] of KONTROLNI_PRIPADY) {
    const vysledek = vypocet();
    if (vysledek !== ocekavano) throw new Error(`Kontrolní případ selhal (${popis}): ${vysledek} místo ${ocekavano}. Nepočítej dál.`);
  }
  return `${KONTROLNI_PRIPADY.length} kontrolních případů v pořádku`;
}
```

## Kontrolní případy

Případy jsou v poli `KONTROLNI_PRIPADY` a ověřuje je `kontrola()`. Všechny
musí projít. Když `kontrola()` selže, výsledek nepoužij a vrať věc člověku.

| Vstup | Očekávaný konec | Co testuje |
|---|---|---|
| `konec("2026-12-15", 15, "dny")` | 30. 12. 2026 | svátky uvnitř běhu se počítají |
| `konec("2026-04-30", 1, "dny")` | 4. 5. 2026 | svátek 1. 5. a víkend za sebou |
| `konec("2026-03-05", 3, "dny")` | 9. 3. 2026 | stížnost v tr. ř., posun z neděle |
| `konec("2026-03-31", 3, "mesice")` | 30. 6. 2026 | konec měsíce podle o. s. ř. |
| `konec("2026-03-31", 3, "mesice", "dr")` | 1. 7. 2026 | daňový řád, o den později |
| `konec("2026-03-02", 2, "mesice")` | 4. 5. 2026 | přihláška pohledávky, posun ze soboty |
| `konec(fikce("2026-04-23"), 15, "dny")` | 19. 5. 2026 | úložní doba končí v neděli |
| `konec(fikce("2026-04-21"), 15, "dny")` | 19. 5. 2026 | úložní doba končí na svátek 1. 5. |
| `konec("2026-11-13", 15, "dny")` | 30. 11. 2026 (pondělí) | doručení v pátek; 1. 12. 2026 je chybně |

## Pasti

- **Rozhodná událost se liší podle předpisu:** doručení, oznámení, právní
  moc, dozvědění se. Správný výpočet z nesprávného data je nejtišší chyba.
- **§ 199 odst. 1 insolvenčního zákona:** lhůta je zachována, jen když
  žaloba soudu nejpozději poslední den **dojde**. Odeslání poslední den
  nestačí.
- **Složené lhůty:** u incidenční žaloby podle § 198 odst. 1 IZ rozhoduje
  pozdější ze dvou konců. Spočítej oba a vezmi `max`.
- **Insolvence:** zveřejnění v ISIR a doručení zvláštním způsobem mohou mít
  různá data (§ 74 IZ).
- **Chybějící nebo nesprávné poučení** mění délku lhůty (například § 204
  odst. 2 o. s. ř.).
- **Prominutí zmeškání** má v každém předpisu jinou lhůtu a u dovolání,
  správní žaloby a kasační stížnosti je vyloučeno.
- Nepokryto a vrať člověku: promlčení podle § 609 a násl. o. z., exekuční
  řád, zvláštní řízení soudní, neúčinnost doručení (§ 50d o. s. ř.).

Podrobný katalog a odůvodnění jsou v rešerši LAWOSS „Počítání lhůt
v českém právu“ (Vojta Říha, 15. 8. 2026) v koordinačním repozitáři
`Omni-Legal-Products/lawOSS-like-SK-CZ`.
