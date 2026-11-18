---
name: crz-register-zmluv-remote
description: Vzdialená verzia pre self-hosted server LAWOSS. Použi pri otázkach na zverejnené zmluvy verejného sektora, ich prílohy, klauzuly, sumy, strany alebo nové záznamy v Centrálnom registri zmlúv. Use for Slovak public contracts, CRZ clauses, attachments, comparable contracts, and CRZ monitoring.
---

# CRZ — Centrálny register zmlúv

> **Vzdialený režim:** server neponúka nástroj `crz_download_attachment`; súbory na server neukladá. Pred postupmi nižšie si prečítaj časť „Vzdialený režim“ na konci.

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
- Prílohy s nepodporovanou príponou vrátia
  `unsupported_attachment_type:<ext>` namiesto extrahovaného textu.

## Vzdialený režim

Táto verzia skillu je pre pripojenie na self-hosted server LAWOSS. Nástroje bežia na serveri, nie na tvojom počítači: nič lokálne neinštaluj a nepoužívaj lokálne CLI. Pripojenie nastavuje používateľ alebo správca, prihlásenie zabezpečuje server, takže pokyny o lokálnom `stdio`, inštalácii alebo o samostatnom nasadení jednotlivej služby (OAuth, bearer, `MCP_AUTH_MODE`, `EXPORT_DIR`) sa na toto pripojenie nevzťahujú. Ak sa postup vyššie líši od tejto časti, platí táto časť.

Tieto nástroje server neponúka; namiesto nich postupuj takto:

- `crz_download_attachment` — text podporovanej prílohy (PDF, DOCX, UTF-8 TXT) načítaj cez `crz_contract_to_markdown`; samotný súbor prílohy stiahne len lokálny plugin.

Tieto nástroje sú dostupné bez argumentov, ktoré ukladajú súbory na server:

- `crz_contract_to_markdown` bez `save_to_dir`

Server tieto argumenty v schéme nástroja neuvádza. Ak ich predsa pošleš, volanie odmietne s textom „Ukladanie súborov na server nie je dostupné; výsledok dostanete v odpovedi.“ Vynechaj ich a výsledok čítaj priamo z odpovede.

Nástroj, ktorý server vyhradil lokálnemu pluginu alebo ho ešte nepreveril, v zozname nástrojov nevidíš a jeho volanie vráti chybu „Tento nástroj je dostupný len v lokálnom plugine.“ Nie je to prázdny výsledok ani výpadok zdroja. Volanie neopakuj a použi náhradu uvedenú vyššie. Ak používateľ potrebuje súbor na disku alebo uložený stav, odporuč mu lokálny plugin `crz` z katalógu LAWOSS.
