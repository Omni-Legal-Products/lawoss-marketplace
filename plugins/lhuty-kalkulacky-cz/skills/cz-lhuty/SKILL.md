---
name: cz-lhuty
description: Deterministický výpočet procesních a hmotněprávních lhůt podle českého práva, včetně fikce doručení, posunu konce lhůty a odlišné aritmetiky daňového řádu. Použij vždy, když má agent určit poslední den lhůty v české věci. Výsledek je návrh k ověření advokátem. Plugin obsahuje jen skill, bez MCP.
---

Tento plugin nepřipojuje MCP, neobsahuje runtime ani přihlašovací údaje.
Výpočet provede agent spuštěním kódu níže. Datum nikdy neodhaduj
v hlavě.

# Lhůty podle českého práva

## Zásady

1. **Výpočet je kalendářní aritmetika, ne úsudek modelu.** Spusť funkce níže
   v Pythonu nebo je převeď do jiného jazyka beze změny logiky.
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

## Kód

```python
from datetime import date, timedelta
import calendar

def velikonoce(rok):  # algoritmus Meeus/Jones/Butcher, gregoriánský kalendář
    a = rok % 19; b, c = divmod(rok, 100); d, e = divmod(b, 4); f = (b + 8) // 25
    g = (b - f + 1) // 3; h = (19 * a + b - d - g + 15) % 30; i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7; m = (a + 11 * h + 22 * l) // 451
    mes, den = divmod(h + l - 7 * m + 114, 31)
    return date(rok, mes, den + 1)

def svatky(rok):  # § 1 a § 2 zák. č. 245/2000 Sb.
    v = velikonoce(rok)
    s = {date(rok, m, d) for m, d in [(1, 1), (5, 1), (5, 8), (7, 5), (7, 6), (9, 28),
                                       (10, 28), (11, 17), (12, 24), (12, 25), (12, 26)]}
    s.add(v + timedelta(days=1))          # Velikonoční pondělí
    if rok >= 2016:
        s.add(v - timedelta(days=2))      # Velký pátek
    return s

def posun(d):
    while d.weekday() >= 5 or d in svatky(d.year):
        d += timedelta(days=1)
    return d

def plus_mesice(d, n):
    m = d.month - 1 + n; r = d.year + m // 12; m = m % 12 + 1
    return date(r, m, min(d.day, calendar.monthrange(r, m)[1]))

def konec(udalost, pocet, jednotka, rezim="osr"):
    """udalost: den rozhodné skutečnosti; jednotka: dny | tydny | mesice | roky;
    rezim: osr (o. s. ř., tr. ř., s. ř. s., spr. ř., o. z.) nebo dr (§ 33 d. ř.)."""
    if jednotka == "dny":
        k = udalost + timedelta(days=pocet)
    else:
        z = udalost + timedelta(days=1) if rezim == "dr" else udalost
        k = z + timedelta(weeks=pocet) if jednotka == "tydny" else \
            plus_mesice(z, pocet * (12 if jednotka == "roky" else 1))
    return posun(k)

def fikce(dodani):  # DS i pošta: konec desetidenní úložní doby s posunem
    return posun(dodani + timedelta(days=10))
```

## Kontrolní případy

Před prvním použitím v sezení kód ověř. Všechny případy musí projít.

| Vstup | Očekávaný konec | Co testuje |
|---|---|---|
| `konec(date(2026,12,15), 15, "dny")` | 30. 12. 2026 | svátky uvnitř běhu se počítají |
| `konec(date(2026,4,30), 1, "dny")` | 4. 5. 2026 | svátek 1. 5. a víkend za sebou |
| `konec(date(2026,3,5), 3, "dny")` | 9. 3. 2026 | stížnost v tr. ř., posun z neděle |
| `konec(date(2026,3,31), 3, "mesice")` | 30. 6. 2026 | konec měsíce podle o. s. ř. |
| `konec(date(2026,3,31), 3, "mesice", "dr")` | 1. 7. 2026 | daňový řád, o den později |
| `konec(date(2026,3,2), 2, "mesice")` | 4. 5. 2026 | přihláška pohledávky, posun ze soboty |
| `konec(fikce(date(2026,4,23)), 15, "dny")` | 19. 5. 2026 | úložní doba končí v neděli |
| `konec(fikce(date(2026,4,21)), 15, "dny")` | 19. 5. 2026 | úložní doba končí na svátek 1. 5. |

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
