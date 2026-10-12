---
name: crz-register-zmluv
description: Použi pri otázkach na zverejnené zmluvy verejného sektora, ich prílohy, klauzuly, sumy, strany alebo nové záznamy v Centrálnom registri zmlúv. Use for Slovak public contracts, CRZ clauses, attachments, comparable contracts, and CRZ monitoring.
---

# CRZ — Centrálny register zmlúv

## Lokálny plugin

Tento plugin spúšťa pribalený CRZ MCP lokálne cez stdio. Vyžaduje Node.js 22.14+ a npm; závislosti sa pripravia pri prvom štarte. Nepripája sa na vzdialený MCP a nevyžaduje prihlasovanie do LAWOSS služby. Pri chybe štartu skontroluj Node/npm a výstup `node scripts/run.mjs doctor` z adresára pluginu.

CLI používa tie isté nástroje: `node scripts/run.mjs tools` alebo `node scripts/run.mjs call crz_recent '{"limit":1}'`. Cestu k skriptu odvoď z umiestnenia tohto skillu, nie z pracovného projektu. Preferuj už pripojené MCP nástroje; CLI je alternatívne rozhranie.

## Kedy použiť CRZ

- dohľadanie zmluvy alebo dodatku podľa predmetu, strany, IČO, sumy či obdobia;
- získanie metadát a originálnych príloh verejnej zmluvy;
- konverzia podporovaných PDF, DOCX alebo UTF-8 TXT príloh na Markdown;
- heuristické vybratie sankcií, platobných podmienok, ukončenia a iných klauzúl;
- porovnanie podobných verejných zmlúv alebo kontrola nových záznamov.

Na verejné obstarávanie pred podpisom použi ÚVO, na údaje o spoločnosti ORSR,
na konečných užívateľov výhod RPVS a na právny predpis Slov-Lex.

## Odporúčaný postup

1. `crz_search` zúži vec, obdobie a strany. Ďalšiu stranu pýtaj s
   `page: next_page` **a** `offset: next_offset`.
2. `crz_get_contract` overí metadáta a identitu záznamu.
3. `crz_contract_to_markdown` načíta podporovaný text a upozornenia.
4. `crz_extract_clauses` vyberie relevantné ustanovenia; prečítaj `warnings`.
5. `crz_find_similar_contracts` rozšíri porovnávaciu vzorku.

Zmluvy subjektu: `crz_search` s `ico` (obe strany zmluvy). Len jedna strana:
`ico_dodavatel` alebo `ico_objednavatel`.

Na monitoring použi `crz_recent`, ulož `max_datum` a pri ďalšej kontrole ho
odovzdaj do `crz_whats_new` ako `since_date`; duplicity odfiltruj podľa id.
Pri `truncated: true` zúž filter alebo zvýš `max_pages`.

## Pasce

- **Chýbajúca kategória v `crz_extract_clauses` neznamená, že zmluva také
  ustanovenie nemá.** Heuristika triedi podľa nadpisov článkov; `warnings`
  hovorí, ktoré kategórie nenašla a či text obsahuje napríklad „zmluvnú
  pokutu“ mimo rozpoznaného nadpisu.
- **`since_id` samo nezaručí úplnosť.** CRZ triedi podľa dátumu zverejnenia a
  id nie sú pridelené v poradí zverejnenia. Spoľahlivý vodoznak je
  `since_date`; `complete: true` dostaneš len s ním. `truncated: true`
  znamená neúplný výsledok, nie „nič nové“.
- **`ico` sa pýta na obe strany** (dodávateľ aj objednávateľ) a zdvojnásobí
  počet dopytov na CRZ. Riadok hovorí v `ico_zhoda`, kde IČO sedí. Strana N
  je zlúčená strana N oboch dopytov (až 40 riadkov, zoradené podľa dátumu).
- **Dátumy** `YYYY-MM-DD` alebo `DD.MM.YYYY`; iný zápis vráti chybu (nikdy sa
  ticho nevypne filter).
- **Počet strán CRZ neuvádza.** `total_pages_hint` je len vtedy, keď je
  presný; inak `total_pages_at_least` (dolná hranica okna stránkovania).
- **Dodatky a stav zmluvy** parser zatiaľ nečíta ako samostatné polia; ak ich
  CRZ zobrazí, objavia sa v `ine_polia` a vo `warnings`.

## Bezpečné používanie výsledkov

- Výsledok vždy spoj s CRZ ID/URL a over proti originálu.
- Heuristická extrakcia ani deterministický súhrn nie sú právnym stanoviskom.
- Prázdny text zo skenu nemusí znamenať prázdnu prílohu; skontroluj warning a originál.
- OCR posiela dokument externému poskytovateľovi iba vtedy, keď je zapnuté a má API kľúč.
- `save_path` zapisuje na filesystem servera; používaj iba kontrolovanú cestu.
- Nepodporované prípony sa dajú stiahnuť, ale vrátia
  `unsupported_attachment_type:<ext>` namiesto extrahovaného textu.
