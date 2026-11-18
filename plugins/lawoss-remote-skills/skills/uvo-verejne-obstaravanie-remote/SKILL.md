---
name: uvo-verejne-obstaravanie-remote
description: Vzdialená verzia pre self-hosted server LAWOSS. Použi pri otázkach na verejné zákazky vo Vestníku ÚVO, obstarávateľa, tender, CPV alebo oznámenie; uses the read-only uvo_search, uvo_get_notice and uvo_get_contracting_authority MCP tools.
---

# ÚVO — verejné obstarávanie

> **Vzdialený režim:** táto verzia je pre self-hosted server LAWOSS; server ponúka všetky nástroje, ktoré skill spomína. Pred postupmi nižšie si prečítaj časť „Vzdialený režim“ na konci.

## Nástroje a kontrakty

1. uvo_search: použi aspoň jedno z ico (8 číslic vrátane úvodných núl), authorityName, contractName, cpv, nuts; voliteľne contractType (TOVARY, SLUZBY, PRACE, SUHRNY), updatedWithinDays, page. resultCount je celkový počet podľa zdroja; ďalšia strana podľa pagination.nextParam (page=N).
2. uvo_get_notice: použi číselný noticeId z dôveryhodného kontextu; vráti obstarávateľa, predmet a kanonický sourceUrl. Pri oznámení o výsledku čítaj estimatedValue (predpokladaná) oddelene od finalValue (konečná) a víťaza v awardedTo.
3. uvo_get_contracting_authority: použi presne osemmiestne ASCII ico; contractCount je celkový počet zákaziek, limit je 1–2,000 a agregácia má strop 20 strán po 50 riadkoch.

Vždy skontroluj sourceValidated, retrievedAt, truncated, truncationReason, warnings. Chyby UVO_INPUT, UVO_HTTP, UVO_TIMEOUT, UVO_CONTENT_TYPE, UVO_SCHEMA, UVO_UNAVAILABLE, UVO_NOT_FOUND, UVO_PAGE_OUT_OF_RANGE neinterpretuj ako nulový výsledok. UVO_UNAVAILABLE je výpadok zdroja a UVO_TIMEOUT aj falošné „Nenašli sa žiadne záznamy“ po časovom limite zdroja — povedz, že zdroj nebol dostupný, nie že nič neexistuje.

**English summary.** Preserve the exact three tool names and treat truncation/error metadata as part of every conclusion.

## Limity a právna hranica

Zdrojom je meniace sa HTML. Odpoveď je 512 KiB, pole 8 KiB, upstream concurrency 4. Prázdna odpoveď (resultCount 0) je platná iba ako rýchle výslovné hlásenie zdroja „Nenašli sa žiadne záznamy“ na strane 1. eForms oznámenia uvádzajú hlavné CPV a miesto plnenia len slovne (mainCpvLabel, placeNutsLabel), DPH pri hodnote neuvádzajú (vat null) a dodávateľa ani hodnotu zmluvy z nich server nevyberá — over na sourceUrl. Oznámenie nie je uzavretá zmluva a technický výstup nie je právnym poradenstvom; pre zmluvu použi CRZ a pre subjekt ORSR.

**English summary.** HTML is unstable, output is bounded, and a procurement notice is neither a signed contract nor legal advice.

## Podpora

Pri chybe uveď tool, typovaný kód, čas a redigovaný popis; neprikladaj raw URL s query, body, hlavičky, cookie, IP, cesty ani výnimku. Pozri SUPPORT.md a SECURITY.md.

**English summary.** Report only redacted technical context and use the repository support/security process.

## Vzdialený režim

Táto verzia skillu je pre pripojenie na self-hosted server LAWOSS. Nástroje bežia na serveri, nie na tvojom počítači: nič lokálne neinštaluj a nepoužívaj lokálne CLI. Pripojenie nastavuje používateľ alebo správca, prihlásenie zabezpečuje server, takže pokyny o lokálnom `stdio`, inštalácii alebo o samostatnom nasadení jednotlivej služby (OAuth, bearer, `MCP_AUTH_MODE`, `EXPORT_DIR`) sa na toto pripojenie nevzťahujú. Ak sa postup vyššie líši od tejto časti, platí táto časť.

Server ponúka všetky nástroje, ktoré tento skill spomína; žiadny z nich nie je vyhradený lokálnemu pluginu.

Nástroj, ktorý server vyhradil lokálnemu pluginu alebo ho ešte nepreveril, v zozname nástrojov nevidíš a jeho volanie vráti chybu „Tento nástroj je dostupný len v lokálnom plugine.“ Nie je to prázdny výsledok ani výpadok zdroja. Volanie neopakuj a pokračuj dostupnými nástrojmi. Ak používateľ potrebuje súbor na disku alebo uložený stav, odporuč mu lokálny plugin `uvo` z katalógu LAWOSS.
