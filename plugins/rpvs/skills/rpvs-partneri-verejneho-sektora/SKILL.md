---
name: rpvs-partneri-verejneho-sektora
description: Použi pri otázkach na zápis, konečného užívateľa výhod alebo vzťahy slovenského partnera verejného sektora, najmä pri verejnom obstarávaní alebo AML screeningu. SK - RPVS, KUV, partner verejného sektora, oprávnená osoba, verejný funkcionár. EN - public sector partner, UBO register, beneficial owner disclosure.
---

# RPVS — partneri verejného sektora

## Rozsah

Server iba číta verejné RPVS OData API. Vracia registerové údaje o partnerovi,
KUV, oprávnených osobách, verejných funkcionároch, kvalifikovaných podnetoch a
metadata verifikačných dokumentov. Binárne dokumenty nesťahuje.

## Paved road

1. Ak poznáš IČO, použi presne osem ASCII číslic. Nemeň dĺžku, nedopĺňaj nuly
   a neodstraňuj medzery ani interpunkciu.
2. Zavolaj `rpvs_search` na rozlíšenie partnera. Pri názve skontroluj viac
   kandidátov a stav `active`/`validTo`.
3. Zavolaj `rpvs_get_partner` na vybraný záznam. `includeHistory` zapni len ak
   potrebuješ časovú históriu; `includeVerifications` pridáva iba metadata.
4. Pri dávke použi `rpvs_bulk_lookup` najviac s 20 IČO. Spracovanie je
   sekvenčné a každá položka má vlastný výsledok.
5. Pri výstupe uveď zdroj, čas získania a obmedzenie verejného registra.

## Interpretácia

- `not_found` znamená iba to, že tento dopyt nenašiel záznam v RPVS.
- Chýbajúce alebo neplatné relation riadky sa normalizujú; `noRelations`
  opisuje normalizované polia, nie právny stav mimo zdroja.
- `current` a `active` vychádzajú z otvorenej časovej platnosti záznamu.
- KUV, vzťahy a verifikačné metadata nie sú samy osebe vlastníckym ani právnym
  stanoviskom. Pre štatutárov a bežný výpis spoločnosti použi ORSR; pre zmluvy
  CRZ; pre obstarávanie UVO; pre úpadok RU.
- Výstup nie je právna rada ani náhrada odbornej verifikácie.

## Bezpečné chyby a súkromie

Chybový výsledok používa MCP `isError` a stabilný kód, napríklad
`INVALID_ICO`, `UNSAFE_PAGINATION_LINK` alebo `UPSTREAM_ERROR`. Surový vstup,
upstream body a query URL sa do chyby ani logu nevkladajú. Pagination môže
pokračovať iba na nakonfigurovanom HTTPS origin a v jeho API ceste.

Lokálny stdio režim stále používa verejnú sieť k RPVS; nie je offline.
Vzdialený režim je určený na súkromné self-hostovanie cez TLS a OAuth/PKCE.
Autorizáciu dokonči manuálne v klientovi a nikdy nevkladaj heslá ani tokeny do
promptu, dokumentácie alebo repozitára.
