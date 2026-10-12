---
name: disq-diskvalifikacie
description: >-
  Použi pri mennom vyhľadávaní v slovenskom verejnom Registri diskvalifikácií
  alebo pri načítaní detailu vybraného DISQ záznamu. English triggers include
  Slovak disqualification register name search and record detail.
---

# DISQ — verejný register diskvalifikácií

Použi presne dvojkrokový postup:

1. Zavolaj `disq_check` s menom. Voliteľné `dob` a `ico` sú iba vstupné pomôcky; dátum narodenia a IČO nie sú vo verejnom zdroji searchable, neposielajú sa upstream a výsledok ich označí len ako provided/ignored.
2. Pri relevantnom kandidátovi zavolaj `disq_get_detail` s nepriehľadným `registreGuid` z výsledku.

`disq_check` vracia `matches`, `no_match` alebo `incomplete`. `no_match` interpretuj iba ako úplný, validovaný nulový výsledok so `sourceValidated: true`; nie ako dôkaz totožnosti, bezúhonnosti ani spôsobilosti. Neúplný alebo orezaný zdroj je vždy `incomplete`.

## Pasce

- **Zhoda mena nie je identifikácia osoby.** Zdroj hľadá každé slovo dopytu ako začiatok slova v mene, v ľubovoľnom poradí, takže „Tibor X“ nájde aj „Tiborné X“; menovci sú v registri bežní. Pri každej zhode čítaj `matchType` (`exact` = rovnaké meno, `prefix` = iné meno zachytené predponou). `identityVerified` je vždy `false`; `disqualified` je len zastaraný alias `nameMatchFound` — nikdy z neho nepíš, že osoba „je diskvalifikovaná“. Menovcov odlíš nezávislými autoritatívnymi podkladmi (rozhodnutie súdu podľa spisovej značky).
- **Tituly a iniciály.** Server ich z dopytu odstráni (zdroj by inak vrátil 0) a uvedie `QUERY_TITLES_REMOVED` alebo `QUERY_INITIALS_REMOVED_BROADENED`. Odstránená iniciála rozširuje dopyt — zhody sú typicky `prefix` a patria aj iným osobám.
- **`no_match` platí len pre tento tvar mena.** Iné priezvisko (rodné, po sobáši) alebo preklep vráti 0; skús aj tieto tvary.
- **`currentlyDisqualified`** počíta obe hranice obdobia ako zahrnuté a „dnes“ ako kalendárny deň v `Europe/Bratislava` (`evaluatedOn`, `intervalBasis`). Či je `vylucenieDo` právne posledným dňom zákazu, server neposudzuje. Pri chýbajúcom alebo neplatnom období je `undefined` s varovaním `DISQUALIFICATION_INTERVAL_*`.
- **`updateDate` v detaile je dátum zmeny záznamu**, nie aktuálnosť registra; tú vracia `disq_check`.

Všímaj si `updateDate`, `retrievedAt`, `warnings` a chýbajúce polia. Verejný zdroj môže byť nedostupný, neúplný alebo zmenený.

Úspešné výsledky obsahujú len dokumentované verejné polia: meno, súd, adresa, dátumy, spisové údaje a GUID potrebný pre dvojkrokový tok. Chyby majú stabilné kódy `DISQ_INPUT`, `DISQ_NOT_FOUND` (zdroj odpovedal 404 na `registreGuid`), `DISQ_HTTP`, `DISQ_TIMEOUT`, `DISQ_CONTENT_TYPE` alebo `DISQ_SCHEMA`.

Výstup vždy formuluj opatrne: ide o technický výpis z verejného zdroja, nie je právnym poradenstvom. Pri právnom alebo obchodnom úkone over originálny záznam a identitu osoby.

## Inštalácia v LAWOSS

Pribalený lokálny runtime a CLI vyžadujú Node.js 22.14+ a npm. Prvý štart nainštaluje uzamknuté závislosti; ďalšie štarty použijú vyrovnávaciu pamäť. Podrobnosti a obmedzenia sú v README pluginu.
