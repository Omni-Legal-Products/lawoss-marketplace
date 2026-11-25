---
name: kalkulacky-pravne-vypocty
description: Použi na vyčíslenie peňažného nároku podľa slovenského práva — úrok z omeškania, trovy právneho zastúpenia, súdny poplatok, trovy exekúcie — a na výpočet posledného dňa procesnej lehoty (CSP, SSP, doručenie do e-schránky). SK - úrok z omeškania, trovy zastúpenia, súdny poplatok, trovy exekúcie, vyčíslenie nároku, tarifná odmena advokáta, kedy končí lehota, posledný deň lehoty, lehota na odvolanie, 15 dní od doručenia, fikcia doručenia, e-schránka. EN - default interest, attorney fees, court fee calculation, enforcement costs, procedural deadline, last day of deadline, Slovak legal calculator.
---

# Kalkulačky — slovenské právne výpočty

## Načo to je

Server počíta úrok z omeškania, trovy právneho zastúpenia, súdny poplatok a trovy
exekúcie podľa aktuálnych tabuliek a posledný deň procesnej lehoty (`koniec_lehoty`). Nie je právne stanovisko — vstupy aj výstup si
over, výpočet ide priamo do žaloby.

## Kedy sem siahnuť

- **Príprava žaloby alebo návrhu** — vyčíslenie istiny, úroku, poplatku aj trov naraz.
- **Kontrola výpočtu protistrany** — rovnaký vstup nad rovnakým snapshotom dá vždy
  rovnaký výsledok.
- **Audit tabuliek** — história sadzieb ECB a výpočtových základov cez `sadzby_info`.
- **Doloženie výpočtu v podaní** — rozpis po úsekoch, nie len konečná suma.
- **Kedy končí lehota** — „15 dní od doručenia“, lehota na odvolanie, vyjadrenie či
  odpor: `koniec_lehoty` vráti posledný deň, každý krok výpočtu a právny základ.

## Kedy sem nesiahať

| Otázka | Kam namiesto toho |
|---|---|
| Znenie predpisu, o ktorý sa výpočet opiera | Slov-Lex |
| Ako súdy dané ustanovenie vykladajú | Judikáty |

## Osvedčené postupnosti

1. **Na vyčíslenie:** volaj priamo daný nástroj (`urok_z_omeskania`,
   `trovy_pravneho_zastupenia`, `sudny_poplatok`, `trovy_exekucie`) s presnými dátumami.
2. **Na overenie tabuliek:** `sadzby_info` pred tým, než sa výsledok použije v podaní —
   ukáže verziu a dátum dát, z ktorých výpočet vychádza; `ecbVekDni` a `upozornenia[]`
   povedia, či je tabuľka ECB staršia než 14 dní (najmä lokálne stdio a tímové vydanie,
   ktoré nemajú produkčný refresh).
3. **Trovy exekúcie pri zastavení:** vždy zadaj `inyDovodUkonceniaVLehote` (true = dôvod
   ukončenia nastal do uplynutia lehoty na návrh na zastavenie → paušál 50 %, § 22 ods. 2).
   Pri `platitelDph` zadaj `datumPlnenia` — DPH bola do 31. 12. 2024 20 %, od 2025 23 %.
4. **Koniec lehoty:** zisti z listiny dĺžku lehoty a deň doručenia. Ak išlo o e-schránku,
   zadaj `ulozenieVSchranke`, `doVlastnychRuk` a `prevzate` (+ `datumPrevzatia`) — nástroj
   vypočíta deň doručenia sám (§ 32 zák. 305/2013 Z. z.). Ak deň doručenia nepoznáš,
   **opýtaj sa, neodhaduj ho**. Výsledok podaj ako posledný deň lehoty s krokmi, uveď
   `alternativy[]`, ak nejaké sú (sú vždy neskoršie a menujú otvorený bod), a výslovne povedz,
   že ho musí overiť advokát
   (`overit: true`). Potom **ponúkni zápis lehoty do pamäte prípadu so štítkom „overiť“**
   — zapíš ju len so súhlasom používateľa (karta súhlasu).
5. **Úrok 2009 – 1/2013 so `sposob: "najvyhodnejsi"`:** polročný spôsob (§ 3 ods. 2
   nar. vl. 87/1995) sa vyberie len ak sa sadzba ECB počas omeškania zmenila; pozri
   `alternativy[].podmienkaZmenyEcbSplnena`.

## Pasce

- **Vstup mimo pokrytého obdobia vráti chybu, nie odhad.** Napríklad úrok z omeškania
  je pokrytý len od 1. 1. 2009, DPH v trovách od 1. 1. 2011 — mimo toho nástroj zlyhá
  s vysvetlením namiesto tichého výsledku.
- **Každý výsledok nesie `pravnyZaklad` (citácie ustanovení) a `dataSnapshot` (verzia
  a dátum tabuliek).** Oboje patrí do podania spolu s výsledkom — inak sa výpočet
  nedá spätne overiť.
- **Sadzobník súdnych poplatkov pokrýva len najčastejšie položky**, nie celú prílohu
  zákona, a len znenie od 17. 8. 2026 (zák. 29/2026 Z. z.).
- **Id položky ≠ číslo položky sadzobníka.** `17b` = položka 17 písm. b) (zmena právnej
  formy), kým `17d`/`17e` sú od 17. 8. 2026 **Položka 17b** písm. a)/b) sadzobníka (VZ
  akcionára, predĺženie lehoty pred výmazom). Do podania cituj `citacia` z výstupu, nie id.
- **E-zľava pri `17d`/`17e` je sporná.** Nástroj vráti 140 € bez zľavy (konzervatívne)
  a vo `warnings` uvedie, že pri opačnom výklade § 6 ods. 5 by to bolo 90 € — rozhodni
  vedome.
- **Varovanie o ECB berie do úvahy dátum, ku ktorému sa sadzba hľadá.** Ak warning hovorí,
  že tabuľka pokrýva len do určitého dňa, výsledok môže byť nesprávny — over sadzbu ECB.
- **`trovy_exekucie` bez `datumPlnenia` počíta DPH dnešnou sadzbou** a pri konaní
  začatom pred 2025 to hlási vo `warnings`; bez `inyDovodUkonceniaVLehote` pri zastavení
  počíta plný paušál s warningom.
- **Detekcia cestovného a náhrady za stratu času v trovách je heuristika** nad
  voliteľným textovým poľom `druh` — pri nevyplnenom poli upozornenie nepríde.
- **Právne konštanty sa menia len commitom**, nie automatickým refreshom; refresh
  aktualizuje iba priebežné sadzby (napr. ECB). Lokálne vydanie nemá automatický
  refresh — sadzby ECB sú také, aké má vydanie; sleduj `upozornenia[]` v `sadzby_info`.
- **E-zľava pod zákonné minimum poplatku je interpretácia projektu**, nie doslovné
  znenie predpisu — zákon interakciu zľavy s minimom nerieši. Zdokumentované v
  README (Známe limity) a golden test presne tento prípad počíta (12,50 € z
  minimálnej sadzby 25 €).
- **`koniec_lehoty` pri spornom výklade uvádza ako `poslednyDenLehoty` najskorší deň zo všetkých výkladov** (rozhodnutie vlastníka produktu); použitý výklad je v `kroky[]`. Pri fikcii je správa doručená až deň po poslednom
  dni úložnej lehoty (veľký senát NS SR 1VCdo/8/2025), to nie je otvorený bod. Otvorené body:
  doručenie v sobotu alebo v štátny sviatok, ktorý nie je dňom pracovného pokoja (1. 9.,
  28. 10., 17. 11.), či je deň podľa § 32 ods. 9 prvým dňom lehoty a či sa pri mesiacoch koniec
  viaže na deň doručenia — neskoršie výklady sú v `alternativy[]` s `otvoreneBody`. Nepočíta hodiny, hmotnoprávne lehoty, neplynutie lehoty ani Trestný
  poriadok. Zoznam sviatkov je podľa stavu Slov-Lex k 16. 11. 2026.
- **Nástroj nespája viacero samostatných pohľadávok v jednom volaní.** Pri viacerých
  nárokoch sa volá opakovane, každý so svojím vstupom.

## Pripojenie a autorizácia

Lokálny plugin používa stdio launcher z `.mcp.json` a neobsahuje vzdialený endpoint.
Ak vlastník nasadí vlastný remote server, musí použiť HTTPS a OAuth 2.1 s PKCE `S256`.
OAuth štartuje fail-closed: bez autorizačného hesla, durable token store alebo HTTPS
issuera server nenabehne. Produkčné hodnoty a tajomstvá nepatria do skillu ani repozitára.

**English summary.** Local use is stdio-only. An owner-hosted remote deployment requires
HTTPS, fail-closed OAuth, persistent state, and separate live security/privacy review.

## Inštalácia v LAWOSS

Pribalený lokálny runtime a CLI vyžadujú Node.js 22.14+ a npm. Prvý štart nainštaluje uzamknuté závislosti; ďalšie štarty použijú vyrovnávaciu pamäť. Podrobnosti a obmedzenia sú v README pluginu.
