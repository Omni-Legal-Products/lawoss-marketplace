---
name: eurlex-celex
description: Použi pri otázkach na právne akty EÚ, čísla CELEX, EUR-Lex metadáta, konsolidované znenia, jazykové verzie alebo históriu zmien. Use for read-only EUR-Lex and CELEX research with explicit source and freshness checks.
---

# EUR-Lex CELEX

## Kedy použiť

Použi tento skill pri identifikácii alebo overení aktu EÚ, vyhľadaní čísla CELEX,
kontrole platnosti k dátumu, načítaní verejného znenia, porovnaní jazykov alebo
zistení vzťahov a verzií dokumentov.

## Postup

1. Pri známom identifikátore najprv použi `eurlex_celex_parse` a potom podľa potreby `eurlex_celex_validate` alebo `eurlex_document_get`.
2. Pri právnom tvrdení skontroluj `retrievedAt`, `sourceUrl`, `sourceValidated` a či je odpoveď úplná alebo stránkovaná.
3. Pri jazykovej alebo historickej otázke použi `eurlex_document_languages`, `eurlex_document_versions` alebo `eurlex_document_compare`; na nájdenie konkrétneho ustanovenia v jednom akte použi `eurlex_document_find`.
4. Pri `eurlex_citation_check` rozhoduje `validityStatus` (`in_force` / `not_in_force` / `unknown` / `not_found`), nie samotné `wasValid`. Nástroj počíta s dátumom nadobudnutia platnosti, nikdy s dátumom prijatia; budúci dátum je vždy `unknown`. Platnosť a uplatniteľnosť sú odlišné otázky.
5. `eurlex_search_full_text` vyžaduje samostatné EUR-Lex Web Service credentials; nikdy ich nevkladaj do promptu, repozitára ani logu.
6. Výstup nie je právnym poradenstvom. Uveď, že rozhodujúce znenie, platnosť a uplatniteľnosť treba overiť v oficiálnom EUR-Lex zdroji.

## Osvedčené postupnosti

- **Citácia k dátumu:** `eurlex_celex_validate` (názov, OJ, ELI) → `eurlex_citation_check` →
  pri zmenenom akte `eurlex_document_versions` (zmeny s dátumom účinnosti, konsolidované znenia
  s dátumom konsolidácie) → text príslušného znenia cez `eurlex_document_get`.
- **Čo akt zrušil / čím bol zrušený:** `eurlex_related_find` s `relationship="repeals"` alebo
  `"repealed_by"`; filter vzťahu zúži výsledok ešte pred limitom.
- **Transpozícia smernice:** `eurlex_related_find(relationship="transposed_by")`; `totals` udáva
  celkový počet notifikovaných opatrení, CELEX sektora 7 nesie kód štátu (napr. `…SVK_…`).
- **Originál vs. konsolidované znenie:** `eurlex_document_compare` v rovnakom jazyku dá riadkový
  diff porovnaných okien; pri rôznych jazykoch len zobrazí obe okná vedľa seba.

## Pasce

- **Viac dátumov nadobudnutia platnosti.** Fázované akty ich majú niekoľko (GDPR 24. 5. 2016
  a 25. 5. 2018, AI Act päť). Nástroj berie najskorší ako začiatok platnosti a ostatné vypíše
  v `datesEntryIntoForce`; neskoršie dátumy môžu znamenať účinnosť alebo uplatňovanie len časti
  ustanovení — over v texte aktu.
- **`9999-12-31` nie je dátum.** Je to zástupná hodnota EUR-Lex pre „bez konca platnosti“.
- **`cites` / `cited_by` je právny základ** (vzťah `based_on` v CELLAR), nie každá citácia;
  judikatúra vykladajúca akt sa týmto nástrojom nehľadá.
- **Pri `relationship="all"` sú výsledky rozdelené medzi typy vzťahov.** Ak je `truncated: true`,
  pozri `totals` a dopýtaj konkrétny vzťah s vyšším `limit`.
- **Národné opatrenia majú názov v národnom jazyku** a jedno opatrenie môže transponovať viac
  smerníc (nástroj vráti CELEX patriaci k zadanej smernici).
- **Export `format="xml"` uloží `.zip`.** Formex 4 je viacsúborový balík; PDF sa berie
  prednostne ako PDF/A.
- **ELI majú len niektoré dokumenty** (rozsudky a staršie akty často nie). „No ELI found“
  znamená, že ho CELLAR neeviduje, nie chybu dopytu.
- **`eurlex_document_find` počíta najviac 200 zhôd.** Pri `matchCountCapped: true` je zhôd viac —
  spresni dopyt.

## Kontrakty a limity

- `eurlex_celex_parse`, `eurlex_eli_resolve` a validačné funkcie zachovávajú pôvodný CELEX/ELI formát.
- `eurlex_document_get` je stránkovaný cez `offset_chars` a `max_chars`; rešpektuj `MCP_WINDOW_COMPLETE`, `MCP_TOTAL_CHARS` a `MCP_NEXT_OFFSET`.
- Exporty zapisujú iba do nakonfigurovaného `EXPORT_DIR`; pri lokálnom použití používaj adresár mimo repozitára.
- SOAP full-text vyhľadávanie je voliteľné a podlieha účtu a dennému limitu EUR-Lex.

*English summary: use the CELEX parser and public EUR-Lex tools first, report source freshness and pagination, and keep optional SOAP credentials outside the repository.*

## Transport

Lokálne použitie je `stdio` cez prenosný `.mcp.json`. Vzdialený HTTP režim je
samostatný deployment: nastav vlastný HTTPS origin, bearer/OAuth ochranu,
`ALLOWED_ORIGINS` a izolované export/cache volume. Repozitár neobsahuje osobný
remote endpoint ani automatické prihlasovanie.

## Hranice

Technické testy neoverujú aktuálnu dostupnosť EUR-Lex, právny význam konkrétneho
aktu ani správnosť budúcej konsolidácie. Live testy spúšťaj iba vedome a s
vlastnými credentials.

## Inštalácia v LAWOSS

Pribalený lokálny runtime a CLI vyžadujú Node.js 22.14+ a npm. Prvý štart nainštaluje uzamknuté závislosti; ďalšie štarty použijú vyrovnávaciu pamäť. Podrobnosti a obmedzenia sú v README pluginu.
