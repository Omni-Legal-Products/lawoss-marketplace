---
name: ru-register-upadcov
description: Použi pri otázkach na konkurz, reštrukturalizáciu alebo oddlženie slovenskej firmy či fyzickej osoby — prebieha insolvenčné konanie, kto je správca, aký je stav a história konania. SK - konkurz, reštrukturalizácia, oddlženie, úpadca, insolvenčné konanie, správca konkurznej podstaty, register úpadcov, spisová značka konania. EN - bankruptcy, insolvency proceeding, restructuring, debt relief, bankruptcy trustee, insolvent debtor, register of bankrupts.
---

# RU — register úpadcov

## Načo to je

Register úpadcov (REPLIK) zverejňuje konkurzné, reštrukturalizačné a oddlžovacie
konania vedené na Slovensku. Server podľa mena, obchodného mena, IČO alebo
spisovej značky vyhľadá konanie a načíta jeho detail — úpadcu, súd, správcu,
stav a históriu. Je iba na čítanie a nie je právne stanovisko.

## Kedy sem siahnuť

- **Pred uzavretím zmluvy s neznámou protistranou** — či voči nej neprebieha
  insolvenčné konanie.
- **Pri vymáhaní pohľadávky** — kto je správca, aký je stav konania a od kedy.
- **Due diligence a KYC/AML** — insolvenčné riziko ako súčasť obrazu o osobe
  alebo firme.

## Kedy sem nesiahať

| Otázka | Kam namiesto toho |
|---|---|
| Zákaz výkonu funkcie osoby | DISQ — register diskvalifikácií |
| Finančná kondícia bez prebiehajúceho konkurzu (bonita) | RÚZ |
| Kto je štatutár a ako podpisuje mimo insolvencie | ORSR |
| Plný text verejného oznámenia o konaní | OV — obchodný vestník |
| Kto je konečný užívateľ výhod | RPVS |
| Vyčíslenie úroku z omeškania alebo vymáhanej sumy | Kalkulačky |

## Osvedčené postupnosti

1. Máš IČO — rovno `ru_get_by_ico`, netreba dva kroky.
2. Máš iba meno alebo spisovú značku — `ru_search` a z výsledku `konanieId`
   pošli do `ru_get_case`.
3. Detail vráti len posledný verejný oznam ako metadata, nie plný text —
   spisovú značku daj do OV-MCP `ov_search` (parameter `mark`), z výsledku
   vezmi `idFormular` a tým zavolaj `ov_get_notice` po plné znenie.
   `ov_get_notice` prijíma výhradne `idFormular`, nie spisovú značku.

## Pasce

- **Prebiehajúce konanie mení, s kým vôbec rokuješ.** Vo veci majetku koná
  správca (`spravca.nazov`, `spravca.odDatumu`), nie štatutárny orgán zapísaný
  v ORSR — spôsob konania z výpisu tu neplatí bez ďalšieho.
- **`tabCounts` sú len počítadlá, nie obsah.** Register nevracia zoznam
  veriteľov, pohľadávok ani majetku — len to, koľko položiek je na danej
  záložke.
- **Dátumové polia môžu byť `null`,** ak ich register nezobrazuje alebo má iný
  layout. `null` nie je dôkaz, že údaj neexistuje — pri rozhodujúcom dátume
  over `detailUrl` v origináli.
- **Full-text vyhľadávanie vracia širšie zhody.** `ru_get_by_ico` preto rozdelí
  odpoveď na `exactMatches` a `nonExactMatches`. `count` je iba počet presných
  zhôd, `returnedCount` zahŕňa oba zoznamy, `konania` je alias presných zhôd,
  `sourceTotal` môže byť `null` a `truncated` signalizuje neúplnú stránku.
- **Prázdny výsledok nie je univerzálny negatívny dôkaz.** Za platný ho považuj
  iba pri `sourceValidated: true` a stále uveď čas a rozsah kontroly zdroja.
- **Chybu neprekladaj na nulu.** `isError: true` s kódom `RU_INPUT`,
  `RU_INPUT_TOO_LARGE`, `RU_SOURCE_HTTP`, `RU_SOURCE_REDIRECT`,
  `RU_SOURCE_CONTENT_TYPE`, `RU_SOURCE_SIZE`, `RU_SOURCE_PARSE`,
  `RU_SOURCE_TIMEOUT` alebo `RU_INTERNAL` znamená, že screening nebol úspešný.

## Autorizácia

Predvolená repozitárová konfigurácia používa lokálny `stdio` proces, ktorý stále
volá verejný register cez HTTPS. Vzdialený súkromný Streamable HTTP server sa
pripája iba manuálne na `https://<your-ru-mcp-host>/mcp`; inštalácia ho
nekonfiguruje. Také nasadenie vyžaduje TLS, OAuth, jeden worker a durable store.
Pri prvom pripojení môže klient otvoriť OAuth prihlásenie a jednorazový súhlas.
Heslá ani tokeny nevkladaj do promptu alebo konfigurácie skillu.
