---
name: judikaty-sudne-rozhodnutia-remote
description: Vzdialená verzia pre self-hosted server LAWOSS. Použi pri otázkach na slovenskú judikatúru — ako súdy vykladajú konkrétne ustanovenie, hľadanie rozsudku podľa spisovej značky alebo ECLI, overenie procesného osudu rozhodnutia, podpora argumentácie judikatúrou. SK - rozsudok, judikatúra, výklad ustanovenia, spisová značka, ECLI, ustálená prax súdov. EN - case law, court ruling, judicial interpretation, docket number, ECLI, precedent.
---

# Judikáty — slovenské súdne rozhodnutia

> **Vzdialený režim:** server neponúka nástroje `download_decision_document`, `export_decision_markdown`, `export_decision_markdown_by_reference` a `manage_watchlist`; súbory na server neukladá. Pred postupmi nižšie si prečítaj časť „Vzdialený režim“ na konci.

## Načo to je

Server prehľadáva rozhodnutia Ministerstva spravodlivosti, Najvyššieho súdu a Ústavného
súdu naživo v ich databázach. Ak má inštalácia lokálny index (hostované nasadenie), pridáva
fulltext a citačné vzťahy medzi rozhodnutiami; desktopová inštalácia ho bežne nemá.
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
2. **Na hľadanie rozhodnutí a výklad ustanovenia:** `search_decisions` (živé databázy súdov)
   a `find_decisions_by_law`. `search_decision_text` je fulltext nad lokálnym indexom; ak
   index chýba, sám prejde na živé vyhľadávanie a vráti `mode: "live_fallback"` a
   `fullTextSearch: false` — vtedy ide o metadáta a kľúčové slová, nie fulltext odôvodnenia.
3. **Na procesný osud:** `get_decision_treatment`, prípadne celá reťaz cez `get_case_chain`.
   Výsledok s príznakom `textEstimate` alebo s textom „odhad z textu výroku“ si over
   v samotnom rozhodnutí (`get_decision_markdown_by_reference`), kým naň v podaní spoliehaš.
4. **Na dlhý text:** `get_decision_markdown_by_reference` po oknách; celé znenie
   naraz zbytočne míňa kontext.

## Pasce

- **ÚS metadáta nie sú výrok dokumentu.** `merit` pri ÚS je výsledok prerokovania celého
  spisu a vypĺňa sa len pri rozhodnutí, ktoré spis končí (nález, odmietnutie, zastavenie).
  Položky „Namietané ustanovenie“ v `citedRegulations` sú ustanovenia, ktorých porušenie
  namieta sťažovateľ, nie predpisy citované v rozhodnutí; filter `citedLaw` pre ÚS hľadá
  práve ich.
- **Chýbajúci lokálny index nie je „žiadne rozhodnutia“ ani „bez zásahu“.** Na desktope index
  bežne nie je. `get_decision_treatment`, `get_case_chain` a oba štatistické nástroje vtedy
  vrátia `availability.status: "not_available_on_this_installation"` —
  povedz používateľovi, že sa to tu overiť nedá, nie že sa nič nenašlo. Ak má server index mať, `get_nsud_index_stats` uvádza `indexPath` a
  `indexNote` (index sa číta z `JUDIKATY_DATA_DIR`, inak z `.cache/judiciary` v pracovnom
  adresári procesu).
- **Príznak procesného osudu rozlišuje „review" od „mention".** Vo vzorke citačných
  vzťahov bola cieľová značka vo výroku citujúceho rozhodnutia len v 2,4 % prípadov —
  server preto citáciu nehlási ako preskúmanie. Chýbajúci príznak znamená „nevieme",
  nie „platí".
- **Väčšina citačných vzťahov nemá zistený výrok** a hlási sa ako `mention` — index sa
  nedopĺňa odhadom.
- **Výrok z textu je odhad, nie fakt.** Zistí sa len z výroku citujúceho rozhodnutia: zo
  slovesa v prítomnom čase („zrušuje“, „mení“, „potvrdzuje“, „odmieta“, „zamieta“,
  „zastavuje“, „nevyhovuje“) a pri ÚS z výroku o porušení práva („porušené bolo/neboli“).
  Minulý čas v odôvodnení („zrušil“) je opis skoršieho konania, nie zásah. Takéto výsledky
  nesú `textEstimate: true`. Pri porovnaní so štítkami modelu (10/2026) sa zhodli v 95 % (NS),
  77 % (ÚS) a 82 % (ostatné súdy). Vzťahy uložené v indexe pred opravou z 10/2026 ešte môžu
  niesť starý odhad — preto ich výstup tiež označuje ako odhad.
- **Procesný osud sa páruje len podľa spisovej značky, bez súdu.** Rovnaká značka býva na
  viacerých krajských či okresných súdoch (napr. `5Co/1/2020` je na KS Žilina, Trenčín aj
  Nitra). Ak výstup obsahuje `ambiguityNote`, nájdené väzby sa môžu týkať iného súdu.
- **`total` pri `find_decisions_by_law` pre NS** sa počíta len z obmedzenej vzorky
  kandidátov; čítaj `coverageNotes` (kompaktný výstup ich od 10/2026 vracia tiež).
- **Pokrytie nižších súdov je oportunistické.** Staršie rozhodnutia nie sú rovnomerne
  dostupné ako plný text.
- **Bežné vyhľadávanie beží naživo.** `search_decisions` a dohľadanie rozhodnutia idú do
  databáz súdov; lokálny index (ak existuje) slúži na fulltext, vzťahy a rýchlejšie čítanie.

## Vzdialený režim

Táto verzia skillu je pre pripojenie na self-hosted server LAWOSS. Nástroje bežia na serveri, nie na tvojom počítači: nič lokálne neinštaluj a nepoužívaj lokálne CLI. Pripojenie nastavuje používateľ alebo správca, prihlásenie zabezpečuje server, takže pokyny o lokálnom `stdio`, inštalácii alebo o samostatnom nasadení jednotlivej služby (OAuth, bearer, `MCP_AUTH_MODE`, `EXPORT_DIR`) sa na toto pripojenie nevzťahujú. Ak sa postup vyššie líši od tejto časti, platí táto časť.

Tieto nástroje server neponúka; namiesto nich postupuj takto:

- `download_decision_document` — text rozhodnutia čítaj po oknách cez `get_decision_markdown` alebo `get_decision_markdown_by_reference`; pôvodný dokument stiahne len lokálny plugin.
- `export_decision_markdown` — dlhý text čítaj po oknách cez `get_decision_markdown`.
- `export_decision_markdown_by_reference` — dlhý text čítaj po oknách cez `get_decision_markdown_by_reference`.
- `manage_watchlist` — na jednorazovú kontrolu procesného osudu použi `get_decision_treatment` alebo `get_case_chain`; trvalé sledovanie potrebuje uložený stav, preto je len v lokálnom plugine.

Tieto nástroje sú dostupné bez argumentov, ktoré ukladajú súbory na server:

- `get_decision_full_text` bez `savePath` a `saveToDefaultPath`
- `get_decision_full_text_by_reference` bez `savePath` a `saveToDefaultPath`

Server tieto argumenty v schéme nástroja neuvádza. Ak ich predsa pošleš, volanie odmietne s textom „Ukladanie súborov na server nie je dostupné; výsledok dostanete v odpovedi.“ Vynechaj ich a výsledok čítaj priamo z odpovede.

Nástroj, ktorý server vyhradil lokálnemu pluginu alebo ho ešte nepreveril, v zozname nástrojov nevidíš a jeho volanie vráti chybu „Tento nástroj je dostupný len v lokálnom plugine.“ Nie je to prázdny výsledok ani výpadok zdroja. Volanie neopakuj a použi náhradu uvedenú vyššie. Ak používateľ potrebuje súbor na disku alebo uložený stav, odporuč mu lokálny plugin `judikaty` z katalógu LAWOSS.
