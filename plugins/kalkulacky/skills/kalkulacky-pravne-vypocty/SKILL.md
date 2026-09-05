---
name: kalkulacky-pravne-vypocty
description: Použi na vyčíslenie peňažného nároku podľa slovenského práva — úrok z omeškania, trovy právneho zastúpenia, súdny poplatok, trovy exekúcie. SK - úrok z omeškania, trovy zastúpenia, súdny poplatok, trovy exekúcie, vyčíslenie nároku, tarifná odmena advokáta. EN - default interest, attorney fees, court fee calculation, enforcement costs, Slovak legal calculator.
---

# Kalkulačky — slovenské právne výpočty

## Načo to je

Server počíta úrok z omeškania, trovy právneho zastúpenia, súdny poplatok a trovy
exekúcie podľa aktuálnych tabuliek. Nie je právne stanovisko — vstupy aj výstup si
over, výpočet ide priamo do žaloby.

## Kedy sem siahnuť

- **Príprava žaloby alebo návrhu** — vyčíslenie istiny, úroku, poplatku aj trov naraz.
- **Kontrola výpočtu protistrany** — rovnaký vstup nad rovnakým snapshotom dá vždy
  rovnaký výsledok.
- **Audit tabuliek** — história sadzieb ECB a výpočtových základov cez `sadzby_info`.
- **Doloženie výpočtu v podaní** — rozpis po úsekoch, nie len konečná suma.

## Kedy sem nesiahať

| Otázka | Kam namiesto toho |
|---|---|
| Znenie predpisu, o ktorý sa výpočet opiera | Slov-Lex |
| Ako súdy dané ustanovenie vykladajú | Judikáty |

## Osvedčené postupnosti

1. **Na vyčíslenie:** volaj priamo daný nástroj (`urok_z_omeskania`,
   `trovy_pravneho_zastupenia`, `sudny_poplatok`, `trovy_exekucie`) s presnými dátumami.
2. **Na overenie tabuliek:** `sadzby_info` pred tým, než sa výsledok použije v podaní —
   ukáže verziu a dátum dát, z ktorých výpočet vychádza.

## Pasce

- **Vstup mimo pokrytého obdobia vráti chybu, nie odhad.** Napríklad úrok z omeškania
  je pokrytý len od 1. 1. 2009, DPH v trovách od 1. 1. 2011 — mimo toho nástroj zlyhá
  s vysvetlením namiesto tichého výsledku.
- **Každý výsledok nesie `pravnyZaklad` (citácie ustanovení) a `dataSnapshot` (verzia
  a dátum tabuliek).** Oboje patrí do podania spolu s výsledkom — inak sa výpočet
  nedá spätne overiť.
- **Sadzobník súdnych poplatkov pokrýva len najčastejšie položky**, nie celú prílohu
  zákona.
- **Detekcia cestovného a náhrady za stratu času v trovách je heuristika** nad
  voliteľným textovým poľom `druh` — pri nevyplnenom poli upozornenie nepríde.
- **Právne konštanty sa menia len commitom**, nie automatickým refreshom; refresh
  aktualizuje iba priebežné sadzby (napr. ECB).
- **E-zľava pod zákonné minimum poplatku je interpretácia projektu**, nie doslovné
  znenie predpisu — zákon interakciu zľavy s minimom nerieši. Zdokumentované v
  README (Známe limity) a golden test presne tento prípad počíta (12,50 € z
  minimálnej sadzby 25 €).
- **Nástroj nespája viacero samostatných pohľadávok v jednom volaní.** Pri viacerých
  nárokoch sa volá opakovane, každý so svojím vstupom.

## Pripojenie a autorizácia

Lokálny plugin používa stdio launcher z `.mcp.json` a neobsahuje vzdialený endpoint.
Ak vlastník nasadí vlastný remote server, musí použiť HTTPS a OAuth 2.1 s PKCE `S256`.
OAuth štartuje fail-closed: bez autorizačného hesla, durable token store alebo HTTPS
issuera server nenabehne. Produkčné hodnoty a tajomstvá nepatria do skillu ani repozitára.

**English summary.** Local use is stdio-only. An owner-hosted remote deployment requires
HTTPS, fail-closed OAuth, persistent state, and separate live security/privacy review.
