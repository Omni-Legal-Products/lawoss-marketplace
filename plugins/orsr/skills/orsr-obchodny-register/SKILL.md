---
name: orsr-obchodny-register
description: Použi pri otázkach na slovenskú firmu z obchodného registra — kto je konateľ, kto koná a ako podpisuje, spoločníci a podiely, spôsob konania, uložené listiny, prepojené subjekty. SK - kto je konateľ, kto koná za firmu, preveriť firmu, preveriť protistranu, spoločníci, podiely, výpis z ORSR, spisová značka. EN - company officers, who can sign, shareholders, ownership, Slovak business register, company extract.
---

# ORSR — obchodný register

## Načo to je

Obchodný register je primárny zdroj pravdy o slovenských právnických osobách.
Server je iba na čítanie a nie je právne stanovisko — výstup si over voči výpisu.

## Kedy sem siahnuť

- **Pred podpisom zmluvy** — kto je oprávnený podpísať a či koná samostatne
  alebo spoločne. Toto je najčastejší dôvod.
- **Preverenie protistrany** — spoločníci, podiely, história zmien v štatutári.
- **KYC/AML** — identifikácia právnickej osoby a jej prepojení.
- **Due diligence** — listiny, kedy bola podaná účtovná závierka, indikátory fúzie
  a nástupníctva.

## Kedy sem nesiahať

| Otázka | Kam namiesto toho |
|---|---|
| Čísla zo závierky: tržby, výsledok, aktíva | RÚZ — register účtovných závierok |
| Je platiteľ DPH, je daňový dlžník | FS — finančná správa |
| Prebieha konkurz alebo reštrukturalizácia | RU — register úpadcov |
| Má osoba zákaz výkonu funkcie | DISQ — register diskvalifikácií |
| Kto je konečný užívateľ výhod | RPVS — partneri verejného sektora |
| Kedy bola zmena zverejnená | OV — obchodný vestník |
| Rýchle overenie existencie subjektu podľa IČO naprieč registrami, právny nástupca po zlúčení | RPO — register právnických osôb |

## Osvedčené postupnosti

Keď máš názov a nie IČO, netreba dva kroky — `*_by_query` nástroje si subjekt
dohľadajú samy.

1. **Na zmluvu:** `orsr_get_company_data` s úrovňou `basic`. Vráti presne to,
   čo patrí do záhlavia, vrátane základného imania (`equityCurrent`) a stavu
   subjektu. Najprv skontroluj `subject.terminated` — vymazaný subjekt zmluvu
   neuzavrie.
2. **Na preverenie:** `orsr_get_company_profile` — stav, imanie, konatelia,
   spoločníci, vklady a spôsob konania naraz. Odkedy niekto funkciu vykonáva,
   ber z `functionCreationDate`, nie z `od`.
3. **Keď treba históriu:** `orsr_get_extract_full`, nie `orsr_get_extract`.
   Základný výpis historické údaje neobsahuje.
4. **Keď hľadáš:** `orsr_search_entities`, prípadne `orsr_lookup_legal_person`
   na rýchly autocomplete.

## Pasce

- **ORSR je citlivé na diakritiku a právnu formu.** Ak názov nezaberie,
  použi IČO alebo spisovú značku — sú spoľahlivejšie.
- **`od`/`do` pri osobách nie je trvanie funkcie.** Je to obdobie zápisu
  v registri (zápis a výmaz). Vznik a skončenie funkcie sú vo
  `functionCreationDate`/`functionTerminationDate`; `null` znamená, že register
  údaj neuvádza — nedopĺňaj ho z `od`. Skončenie funkcie nesie výmazový záznam
  (`registryDeletionRecord: true`, `od` je po `do` zámerne).
- **Vymazaný subjekt.** `subject.terminated: true` a `terminationDate`;
  `nameCurrent`/`addressCurrent` sú vtedy `null`, posledný stav je
  v `nameLastRegistered`/`addressLastRegistered`, dôvod v `legalStatusEvents`
  (napr. zánik zlúčením). `*_by_query` hľadá vymazané subjekty až vtedy, keď
  medzi aktívnymi nič nenájde; `NOT_FOUND` s `searched_including_terminated: true`
  znamená, že ORSR subjekt neeviduje ani medzi vymazanými.
- **Likvidácia nie je výmaz.** `subject.inLiquidation: true` (udalosť
  `LikvidaciaZaciatok`) znamená, že subjekt existuje, ale za neho konajú
  likvidátori — spôsob konania ber z `actingRules.liquidator`. Zrušenie
  (`Zrusenie`) samo osebe neznamená, že subjekt zanikol.
- **Podiely nie sú konečné vlastníctvo.** `ownership.contributions` sú podiely
  na upísaných vkladoch (`value`, splatené v `paidValue`); `coOwned` je vklad
  v spoluvlastníctve. Konečného užívateľa výhod hľadaj v RPVS.
- **Server číta JSON API `sluzby.orsr.sk`.** Pri odstávke vráti ORSR HTML
  namiesto dát — server to hlási ako chybu upstreamu, skús neskôr.
- **Spôsob konania rozhoduje o platnosti podpisu.** Samotný zoznam konateľov
  nestačí; prečítaj aj to, ako konajú.
- **Zápis má dátum.** Pri spore o staršiu skutkovú situáciu potrebuješ stav
  k danému dňu, nie dnešný.
- **Detailové nástroje bývajú pomalé.** `sluzby.orsr.sk` je namerané na ~9 s
  (extract) až ~18 s (autocomplete) na jeden pokus — dlhé čakanie nie je
  zlyhanie, server má na to 25 s na pokus a 40 s celkový rozpočet.
- **`sud` v `orsr_get_extract`/`orsr_get_extract_full` je kód, nie názov**
  (napr. `B`, nie „Bratislava I"). Platnú trojicu oddiel/vložka/súd vráti
  `orsr_search_entities` vo `fileReference`.

## Autorizácia

Tento LAWOSS plugin spúšťa pribalený MCP lokálne cez stdio. Nepotrebuje prihlasovanie do LAWOSS služby. Pri chybe štartu použi `node scripts/run.mjs doctor` z adresára pluginu.

## Inštalácia v LAWOSS

Pribalený lokálny runtime a CLI vyžadujú Node.js 22.14+ a npm. Prvý štart nainštaluje uzamknuté závislosti; ďalšie štarty použijú vyrovnávaciu pamäť. Podrobnosti a obmedzenia sú v README pluginu.
