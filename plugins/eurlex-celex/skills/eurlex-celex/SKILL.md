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
4. Pri `eurlex_citation_check` nepovažuj dátum dokumentu/prijatia za dátum nadobudnutia platnosti a neprojektuj aktuálny stav do budúcnosti. `unknown` znamená, že metadáta nestačia; platnosť a uplatniteľnosť sú odlišné otázky.
5. `eurlex_search_full_text` vyžaduje samostatné EUR-Lex Web Service credentials; nikdy ich nevkladaj do promptu, repozitára ani logu.
6. Výstup nie je právnym poradenstvom. Uveď, že rozhodujúce znenie, platnosť a uplatniteľnosť treba overiť v oficiálnom EUR-Lex zdroji.

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
