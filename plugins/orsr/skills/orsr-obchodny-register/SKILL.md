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
   čo patrí do záhlavia, bez balastu.
2. **Na preverenie:** `orsr_get_company_profile` — konatelia, spoločníci,
   podiely a spôsob konania naraz.
3. **Keď treba históriu:** `orsr_get_extract_full`, nie `orsr_get_extract`.
   Základný výpis historické údaje neobsahuje.
4. **Keď hľadáš:** `orsr_search_entities`, prípadne `orsr_lookup_legal_person`
   na rýchly autocomplete.

## Pasce

- **ORSR web je citlivý na diakritiku a právnu formu.** Ak názov nezaberie,
  použi IČO alebo spisovú značku — sú spoľahlivejšie.
- **Server parsuje verejný web bez oficiálneho API.** Ak ORSR zmení štruktúru
  stránky, parsovanie môže dočasne vypadnúť — skús neskôr.
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

Server beží ako vzdialený MCP cez HTTPS a je chránený OAuth. Pri prvom pripojení
otvorí prehliadač a vyžiada si autorizačné heslo, potom potvrdenie súhlasu.
Heslo je v Dokploy v env premennej `OAUTH_AUTHORIZATION_PASSWORD` daného compose.
