---
name: judikaty-sudne-rozhodnutia
description: Použi pri otázkach na slovenskú judikatúru — ako súdy vykladajú konkrétne ustanovenie, hľadanie rozsudku podľa spisovej značky alebo ECLI, overenie procesného osudu rozhodnutia, podpora argumentácie judikatúrou. SK - rozsudok, judikatúra, výklad ustanovenia, spisová značka, ECLI, ustálená prax súdov. EN - case law, court ruling, judicial interpretation, docket number, ECLI, precedent.
---

# Judikáty — slovenské súdne rozhodnutia

## Načo to je

Server prehľadáva rozhodnutia Ministerstva spravodlivosti, Najvyššieho súdu a Ústavného
súdu nad vlastným indexom, vrátane fulltextu a citačných vzťahov medzi rozhodnutiami.
Je iba na čítanie a nie je právne stanovisko — nájdené rozhodnutie si vždy over, kým
z neho v podaní vychádzaš.

## Kedy sem siahnuť

- **Ako súdy vykladajú konkrétne ustanovenie** — podpora argumentácie výkladom, nie
  len znením.
- **Dohľadanie rozhodnutia**, keď poznáš spisovú značku, ECLI alebo IČS.
- **Overenie procesného osudu veci** — bolo rozhodnutie potvrdené, zmenené, zrušené?
- **Zisťovanie protichodnej praxe** naprieč súdmi pred podaním.
- **Čítanie dlhého rozsudku** bez opakovaného sťahovania toho istého dokumentu.

## Kedy sem nesiahať

| Otázka | Kam namiesto toho |
|---|---|
| Samotné znenie vykladaného ustanovenia | Slov-Lex |
| Vyčíslenie nároku (úrok, trovy, poplatok) | Kalkulačky |
| Je firma zapísaná, kto je štatutár | ORSR |

## Osvedčené postupnosti

1. **Na konkrétne rozhodnutie:** `get_decision_by_reference` podľa ECLI, značky alebo ID.
2. **Na výklad ustanovenia:** `find_decisions_by_law`, prípadne `search_decision_text`
   na fulltext.
3. **Na procesný osud:** `get_decision_treatment`, prípadne celá reťaz cez `get_case_chain`.
4. **Na dlhý text:** `get_decision_markdown_by_reference` po oknách — opakované volanie
   `export_decision_markdown` na celé znenie stojí toľko, čo celý dokument.

## Pasce

- **Príznak procesného osudu rozlišuje „review" od „mention".** Vo vzorke citačných
  vzťahov bola cieľová značka vo výroku citujúceho rozhodnutia len v 2,4 % prípadov —
  server preto citáciu nehlási ako preskúmanie. Chýbajúci príznak znamená „nevieme",
  nie „platí".
- **Väčšina citačných vzťahov nemá zistený výrok** a hlási sa ako `mention` — index sa
  nedopĺňa odhadom.
- **Pokrytie nižších súdov je oportunistické.** Staršie rozhodnutia nie sú rovnomerne
  dostupné ako plný text.
- **Priamy dotaz na súdny portál ide len pri hľadaní rozhodnutia, ktoré ešte nie je
  v indexe.** Bežné vyhľadávanie a čítanie beží nad lokálnym indexom, nie naživo.

## Autorizácia

Vzdialený HTTP transport je OAuth-only, s authorization-code flow, PKCE a jednorazovým
súhlasom po prihlásení. Lokálne stdio beží bez autentifikácie. Repozitár neobsahuje
predvolenú remote URL ani prihlasovacie údaje; tie spravuje operátor mimo Gitu.
