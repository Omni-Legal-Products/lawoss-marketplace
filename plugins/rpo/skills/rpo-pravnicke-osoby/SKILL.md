---
name: rpo-pravnicke-osoby
description: Použi na rýchlu identifikáciu a overenie existencie slovenskej právnickej osoby, podnikateľa alebo orgánu verejnej moci podľa IČO naprieč zdrojovými registrami — aktuálny názov, adresa, právna forma, registračné čísla, právny predchodca a nástupník po zlúčení. SK - existuje subjekt, identifikácia IČO, aktuálny názov a adresa, právna forma, registračné číslo, právny predchodca, nástupník, zlúčenie, splynutie, rozdelenie. EN - entity identification, existence check, legal successor, predecessor, merger, current registered address.
---

# RPO — register právnických osôb

## Načo to je

RPO je agregovaný register identifikačných údajov o právnických osobách,
podnikateľoch a orgánoch verejnej moci naprieč viacerými zdrojovými registrami
(api.statistics.sk). Vracia aktuálny názov, adresu, právnu formu, registračné
čísla, štatutárny orgán, ďalšie osoby (dozorná rada, prokuristi, spoločníci),
spôsob konania, základné imanie, akcie, vklady, dátum zániku a právny stav.
Server je iba na čítanie.

## Kedy sem siahnuť

- **Rýchle overenie existencie** subjektu podľa IČO a jeho aktuálneho stavu
  (aktívny/zrušený) bez potreby hĺbkového profilu.
- **Základná identifikácia** — názov, adresa, právna forma, registračné číslo —
  keď stačí prierez a nie kompletný výpis.
- **Historické zmeny** názvu alebo adresy subjektu.
- **Právne nástupníctvo** po zlúčení, splynutí alebo rozdelení.

## Kedy sem nesiahať

| Otázka | Kam namiesto toho |
|---|---|
| Spôsob konania a štatutári pre právny úkon (zdroj pravdy) | ORSR — RPO ich vracia, ale ako prehľad |
| Podiely spoločníkov a vlastnícka štruktúra | ORSR |
| Uložené listiny, kedy bola podaná závierka | ORSR |
| Čísla zo závierky: tržby, výsledok, aktíva | RÚZ |
| Je platiteľ DPH, je daňový dlžník | FS |
| Prebieha konkurz alebo reštrukturalizácia | RU |

## Osvedčené postupnosti

1. **Máš iba názov, nie IČO:** `rpo_search` s `fullName` (diakritika je
   nepovinná) — z výsledku vezmi IČO alebo interné `id` subjektu.
2. **Na normalizovaný detail:** `rpo_get_entity` s `ico` (server si `id` dohľadá sám
   cez vyhľadávanie) alebo rovno s `id`, ak ho už máš z kroku 1.
3. **Keď treba priebeh zmien, nie iba aktuálny stav:** rovnaký
   `rpo_get_entity`, ale s `showHistoricalData: true` — bez tohto prepínača
   vrátia dátumové polia iba to, čo platí dnes. V histórii čítaj `validTo`:
   záznam s ním už neplatí (bývalý člen orgánu, zrušená činnosť), záznam bez
   neho platí.
4. **Pred tvrdením, že subjekt existuje alebo kde sídli:** skontroluj
   `termination` a `legalStatuses`. Pri zaniknutom subjekte nasleduj
   `successors` (alebo `rpo_get_related`) k nástupcovi.
5. **Pri podozrení na zlúčenie, splynutie alebo rozdelenie:** `rpo_get_related`
   s `ico` alebo `id` — vráti právnych predchodcov aj nástupcov subjektu.

## Pasce

- **RPO je širší, ale plytší než ORSR.** Spôsob konania (`authorizations`),
  štatutárov aj imanie RPO vracia, no pri právnom úkone je zdrojom pravdy ORSR.
  RPO navyše zaokrúhľuje sumy (imanie, menovitá hodnota akcie) na centy.
- **Zaniknutý subjekt vyzerá vo vyhľadávaní ako bežný záznam s menom a
  adresou.** Rozhoduje `termination`; jeho `name`/`address` sú posledné
  zapísané hodnoty a nesú `nameValidTo`/`addressValidTo`. Bez
  `showHistoricalData` vráti detail zaniknutého subjektu názov aj sídlo
  prázdne — to neznamená chybu, ale zánik (pozri `note`).
- **`count: 500` nie je počet zhôd.** Register vracia najviac 500 riadkov bez
  celkového počtu; pri `countIsLowerBound: true` je to len dolná hranica a
  hľadaný subjekt v týchto 500 riadkoch nemusí byť. Dopyt zúž.
- **RPO agreguje z viacerých zdrojových registrov** (api.statistics.sk) a
  aktualizácia jedného zdroja sa do RPO nemusí premietnuť okamžite. Pri
  čerstvej zmene (napr. práve zapísaný nástupník) over aj priamo v pôvodnom
  zdrojovom registri, najčastejšie ORSR.
- **Predchodcovia a nástupcovia sú len jeden krok, nie celý reťazec.** Ak sa
  nástupník sám neskôr zlúčil ďalej, `rpo_get_related` to nezachytí — na
  celú históriu treba prejsť reťazec opakovaným volaním na každý ďalší
  subjekt.
- **Aktuálna identita nie je prvá položka histórie.** Server vyberá otvorený
  záznam bez `validTo`, prípadne najnovší `validFrom`; pri čerstvej zmene vždy
  uveď dátum zdroja a over pôvodný register.
- **Chybový výstup zámerne rediguje IČO, interné ID, názvy a adresy.** Tieto
  hodnoty zostávajú vo výsledku úspešného volania, ale nevstupujú do
  prevádzkových logov ani diagnostického echo vstupu.
- Server neposkytuje právne hodnotenie, iba registerové dáta na ďalšie
  posúdenie.
- **`rpo_search` nemá stránkovanie (žiadny `offset`/`skip`).** Jediný spôsob
  „ísť ďalej" pri `truncated: true` je zvýšiť `limit` (max 500) a zopakovať
  celé volanie odznova, nie dotiahnuť ďalšiu stránku. Pri
  `countIsLowerBound: true` zvýšenie `limit` nepomôže — treba dopyt zúžiť
  filtrami, nie opakovať volanie v nádeji na iný výrez.
- **História veľkej a.s. je drahá.** `showHistoricalData: true` vráti všetkých
  bývalých členov orgánov, dozornej rady, prokuristov aj zrušené činnosti — pri
  Slovenských elektrárňach okolo 180 kB JSON (bez histórie okolo 30 kB). Pýtaj
  si ju, len keď otázka naozaj stojí na priebehu zmien.
- **HTTP 5xx neznamená automaticky široký dopyt.** Môže ísť aj o výpadok
  registra; „nenašlo sa“ z chybovej odpovede netvrď.

## Autorizácia

Tento LAWOSS plugin spúšťa pribalený MCP lokálne cez stdio. Nepotrebuje prihlasovanie do LAWOSS služby. Pri chybe štartu použi `node scripts/run.mjs doctor` z adresára pluginu.

## Inštalácia v LAWOSS

Pribalený lokálny runtime a CLI vyžadujú Node.js 22.14+ a npm. Prvý štart nainštaluje uzamknuté závislosti; ďalšie štarty použijú vyrovnávaciu pamäť. Podrobnosti a obmedzenia sú v README pluginu.
