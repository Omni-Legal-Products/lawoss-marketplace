---
name: crz-register-zmluv
description: Použi pri otázkach na zverejnené zmluvy verejného sektora, ich prílohy, klauzuly, sumy, strany alebo nové záznamy v Centrálnom registri zmlúv. Use for Slovak public contracts, CRZ clauses, attachments, comparable contracts, and CRZ monitoring.
---

# CRZ — Centrálny register zmlúv

## Lokálny plugin

Tento plugin spúšťa pribalený CRZ MCP lokálne cez stdio. Vyžaduje Node.js 22.13+ a npm; závislosti sa pripravia pri prvom štarte. Nepripája sa na vzdialený MCP a nevyžaduje prihlasovanie do LAWOSS služby. Pri chybe štartu skontroluj Node/npm a výstup `node scripts/run.mjs doctor` z adresára pluginu.

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

1. `crz_search` zúži vec, obdobie a strany.
2. `crz_get_contract` overí metadáta a identitu záznamu.
3. `crz_contract_to_markdown` načíta podporovaný text a upozornenia.
4. `crz_extract_clauses` vyberie relevantné ustanovenia.
5. `crz_find_similar_contracts` rozšíri porovnávaciu vzorku.

Na monitoring použi `crz_recent`, ulož `max_id` a pri ďalšej kontrole ho odovzdaj
do `crz_whats_new` ako `since_id`.

## Bezpečné používanie výsledkov

- Výsledok vždy spoj s CRZ ID/URL a over proti originálu.
- Heuristická extrakcia ani deterministický súhrn nie sú právnym stanoviskom.
- Prázdny text zo skenu nemusí znamenať prázdnu prílohu; skontroluj warning a originál.
- OCR posiela dokument externému poskytovateľovi iba vtedy, keď je zapnuté a má API kľúč.
- `save_path` zapisuje na filesystem servera; používaj iba kontrolovanú cestu.
- Nepodporované prípony sa dajú stiahnuť, ale vrátia
  `unsupported_attachment_type:<ext>` namiesto extrahovaného textu.
