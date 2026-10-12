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
   Ak výsledok hlási `matched: false` s poznámkou „Ambiguous reference“, rovnaká značka je
   na viacerých súdoch — vyber kandidáta podľa súdu a zopakuj dotaz s jeho `providerId`
   alebo ECLI. Značky ÚS („PL. ÚS 3/09“, „III. ÚS …“) nájde aj predvolený režim `auto`.
2. **Na výklad ustanovenia:** `find_decisions_by_law`, prípadne `search_decision_text`
   na fulltext.
3. **Na procesný osud:** `get_decision_treatment`, prípadne celá reťaz cez `get_case_chain`.
   Výsledok s príznakom `textEstimate` alebo s textom „odhad z textu výroku“ si over
   v samotnom rozhodnutí (`get_decision_markdown_by_reference`), kým naň v podaní spoliehaš.
4. **Na dlhý text:** `get_decision_markdown_by_reference` po oknách — opakované volanie
   `export_decision_markdown` na celé znenie stojí toľko, čo celý dokument.

## Pasce

- **ÚS metadáta nie sú výrok dokumentu.** `merit` pri ÚS je výsledok prerokovania celého
  spisu a vypĺňa sa len pri rozhodnutí, ktoré spis končí (nález, odmietnutie, zastavenie).
  Položky „Namietané ustanovenie“ v `citedRegulations` sú ustanovenia, ktorých porušenie
  namieta sťažovateľ, nie predpisy citované v rozhodnutí; filter `citedLaw` pre ÚS hľadá
  práve ich.
- **Prázdny lokálny index nemusí znamenať „žiadne rozhodnutia“.** Server číta index z
  `JUDIKATY_DATA_DIR`, inak z `.cache/judiciary` v pracovnom adresári procesu; klient
  spustený z iného adresára dostane prázdny index. `get_nsud_index_stats` uvádza
  `indexPath` a `indexNote` — pri prázdnom výsledku ich skontroluj skôr, než
  vyhlásiš, že judikatúra neexistuje.
- **Príznak procesného osudu rozlišuje „review" od „mention".** Vo vzorke citačných
  vzťahov bola cieľová značka vo výroku citujúceho rozhodnutia len v 2,4 % prípadov —
  server preto citáciu nehlási ako preskúmanie. Chýbajúci príznak znamená „nevieme",
  nie „platí".
- **Väčšina citačných vzťahov nemá zistený výrok** a hlási sa ako `mention` — index sa
  nedopĺňa odhadom.
- **Výrok z textu je odhad, nie fakt.** Zistí sa len zo slovesa v prítomnom čase vo výroku
  citujúceho rozhodnutia („zrušuje“, „mení“, „potvrdzuje“, „odmieta“, „zamieta“); minulý čas
  v odôvodnení („zrušil“) je opis skoršieho konania, nie zásah. Takéto výsledky nesú
  `textEstimate: true`. Vzťahy uložené v indexe pred opravou z 10/2026 ešte môžu niesť
  starý odhad — preto ich výstup tiež označuje ako odhad.
- **Procesný osud sa páruje len podľa spisovej značky, bez súdu.** Rovnaká značka býva na
  viacerých krajských či okresných súdoch (napr. `5Co/1/2020` je na KS Žilina, Trenčín aj
  Nitra). Ak výstup obsahuje `ambiguityNote`, nájdené väzby sa môžu týkať iného súdu.
- **`total` pri `find_decisions_by_law` pre NS** sa počíta len z obmedzenej vzorky
  kandidátov; čítaj `coverageNotes` (kompaktný výstup ich od 10/2026 vracia tiež).
- **Pokrytie nižších súdov je oportunistické.** Staršie rozhodnutia nie sú rovnomerne
  dostupné ako plný text.
- **Priamy dotaz na súdny portál ide len pri hľadaní rozhodnutia, ktoré ešte nie je
  v indexe.** Bežné vyhľadávanie a čítanie beží nad lokálnym indexom, nie naživo.

## Autorizácia

Vzdialený HTTP transport je OAuth-only, s authorization-code flow, PKCE a jednorazovým
súhlasom po prihlásení. Lokálne stdio beží bez autentifikácie a bez OAuth premenných.
Repozitár neobsahuje predvolenú remote URL ani prihlasovacie údaje; tie spravuje
operátor mimo Gitu.

## Inštalácia v LAWOSS

Pribalený lokálny runtime a CLI vyžadujú Node.js 22.14+ a npm. Prvý štart nainštaluje uzamknuté závislosti; ďalšie štarty použijú vyrovnávaciu pamäť. Podrobnosti a obmedzenia sú v README pluginu.
