---
name: rpvs-partneri-verejneho-sektora-remote
description: Vzdialená verzia pre self-hosted server LAWOSS. Použi pri otázkach na zápis, konečného užívateľa výhod alebo vzťahy slovenského partnera verejného sektora, najmä pri verejnom obstarávaní alebo AML screeningu. SK - RPVS, KUV, partner verejného sektora, oprávnená osoba, verejný funkcionár. EN - public sector partner, UBO register, beneficial owner disclosure.
---

# RPVS — partneri verejného sektora

## Rozsah

Server iba číta verejné RPVS OData API. Vracia registerové údaje o partnerovi,
KUV, oprávnených osobách, verejných funkcionároch, kvalifikovaných podnetoch a
metadata verifikačných dokumentov. Binárne dokumenty nesťahuje.

## Paved road

1. Ak poznáš IČO, použi presne osem ASCII číslic. Nemeň dĺžku, nedopĺňaj nuly
   a neodstraňuj medzery ani interpunkciu.
2. S IČO zavolaj priamo `rpvs_get_partner({ ico })`. Podľa mena zavolaj
   `rpvs_search`, skontroluj viac kandidátov a stav `active`/`validTo`, potom
   `rpvs_get_partner({ partnerId })` s poľom `partnerId` z výsledku, nie `id`.
   Číslo vložky z webu RPVS patrí do `insertNumber`.
3. `includeHistory` zapni len ak potrebuješ časovú históriu;
   `includeVerifications` pridáva iba metadata.
4. Pri dávke použi `rpvs_bulk_lookup` najviac s 20 IČO. Spracovanie je
   sekvenčné a každá položka má vlastný výsledok. Stav zápisu čítaj z
   `aktivny` a `vymaz`, nie zo `status`.
5. Pri výstupe uveď zdroj, čas získania a obmedzenie verejného registra.

## Interpretácia

- `not_found` znamená iba to, že tento dopyt nenašiel záznam v RPVS.
- Chýbajúce alebo neplatné relation riadky sa normalizujú; `noRelations`
  opisuje normalizované polia, nie právny stav mimo zdroja. Kolekcia v
  `incompleteCollections` je neúplná: chýbajúci KUV ani podnet z nej nevyvodzuj.
- Tri rôzne identifikátory: `id` v `rpvs_search` je Id záznamu PVS,
  `partnerId` je `Partneri.Id` pre `rpvs_get_partner`, `insertNumber` /
  `cislo_vlozky` je číslo vložky z webu. Zámena vráti iný subjekt.
- Pod jedným IČO môže byť viac registrácií; detail opisuje aktívnu (inak
  naposledy ukončenú) a ostatné sú v `registrations` a `notes`.
- `decisionCode` pri sankčnom konaní je nedekódovaný kód zdroja; zdroj
  číselník nezverejňuje, význam nedomýšľaj. `publicOfficials[].function` je
  vždy `null`, zdroj funkciu neuvádza.
- Hľadanie podľa mena ignoruje veľkosť písmen, nie diakritiku; pri nule skús
  tvar s diakritikou alebo IČO.
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

## Vzdialený režim

Táto verzia skillu je pre pripojenie na self-hosted server LAWOSS. Nástroje bežia na serveri, nie na tvojom počítači: nič lokálne neinštaluj a nepoužívaj lokálne CLI. Pripojenie a prihlásenie spravuje server, takže pokyny vyššie o lokálnom `stdio`, inštalácii alebo vlastnom nasadení sa na toto pripojenie nevzťahujú. Ak sa postup vyššie líši od tejto časti, platí táto časť.

Server ponúka všetky nástroje, ktoré tento skill spomína; žiadny z nich nie je vyhradený lokálnemu pluginu.

Nástroj, ktorý server vyhradil lokálnemu pluginu alebo ho ešte nepreveril, v zozname nástrojov nevidíš a jeho volanie vráti chybu „Tento nástroj je dostupný len v lokálnom plugine.“ Nie je to prázdny výsledok ani výpadok zdroja. Volanie neopakuj a pokračuj dostupnými nástrojmi. Ak používateľ potrebuje súbor na disku alebo uložený stav, odporuč mu lokálny plugin `rpvs` z katalógu LAWOSS.
