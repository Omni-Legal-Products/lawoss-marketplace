---
name: slovlex-zbierka-zakonov
description: Použi keď treba presné znenie slovenského zákona alebo iného predpisu — konkrétny paragraf, znenie k dátumu, dôvodová správa k novele, časové znenie po novele s delenou účinnosťou. SK - paragraf, znenie zákona k dátumu, dôvodová správa, Zbierka zákonov, časové znenie, novela zákona, citácia ustanovenia. EN - statute text, provision as in force on a date, explanatory memorandum, Slovak collection of laws, legislative amendment.
---

# Slov-Lex — Zbierka zákonov

## Načo to je

Slov-Lex je Zbierka zákonov SR — zdroj samotného znenia predpisov, nie ich výkladu.
Server nájde predpis, vráti konkrétny paragraf v znení k dátumu aj dôvodovú správu.
Je iba na čítanie a nie je právne stanovisko; časové znenie si vždy over voči originálu.

## Kedy sem siahnuť

- **Presné znenie paragrafu k dátumu** — najmä keď sa spor týka staršej skutkovej
  situácie a predpis medzitým prešiel novelou.
- **Argumentácia úmyslom zákonodarcu** — dôvodová správa k predpisu alebo novele.
- **Overenie citácie** — či ustanovenie v podaní zodpovedá vtedajšiemu zneniu.
- **Porovnanie znenia** pred a po konkrétnej novele.
- **Vyhľadanie predpisu**, keď poznáš len tému alebo približný rok, nie číslo.

## Kedy sem nesiahať

| Otázka | Kam namiesto toho |
|---|---|
| Ako súdy dané ustanovenie vykladajú | Judikáty |
| Vyčíslenie nároku podľa predpisu (úrok, poplatok, trovy) | Kalkulačky |
| Je firma zapísaná, kto je štatutár | ORSR |

## Osvedčené postupnosti

1. **Na konkrétny paragraf:** `search` → `get_law` → `get_paragraph`. Článok Ústavy
   alebo novely: `get_paragraph` s `paragraph: "Čl. 5"`.
2. **Na znenie k dátumu:** rovnaký postup, potom `get_version` s dátumom — bez neho
   príde aktuálne znenie.
3. **Na úmysel zákonodarcu:** `get_explanatory_reports` → `get_explanatory_report_text`.
   Ak LP poznáš, zadaj `lp`; `law` + `resolve_lp` použi len pri nových zákonoch.
4. **Na celé znenie vrátane príloh (sadzobníky, zoznamy):** `get_version` a stránkuj cez
   `MCP_NEXT_OFFSET`, kým nepríde `MCP_WINDOW_COMPLETE: true`; alebo `save_law_markdown`
   s dostatočným `max_chars` a `read_saved_markdown`.
5. **Na uloženie do spisu:** `save_law_markdown` alebo `save_explanatory_report_markdown`,
   spätné čítanie cez `read_saved_markdown`.

## Pasce

- **Bez dátumu dostaneš aktuálne znenie.** Pri spore o staršiu skutkovú situáciu to
  nesedí — treba explicitne zadať dátum.
- **Novely s delenou účinnosťou** menia rôzne časti predpisu k rôznym dňom; over
  výsledok voči originálu, nespoliehaj sa na jeden dátum pre celý predpis.
- **„Účinnosť tohto znenia … do“ nie je koniec predpisu.** Je to koniec konsolidovaného
  znenia. Ak hlavička uvádza „Nasledujúce znenie“, zavolaj tool s jeho dátumom; riadok
  „POZOR: … označené na zmenu alebo zrušenie“ znamená, že ustanovenie mení už vyhlásená novela.
- **Nečíslovaný odsek sa necituje ako „ods. 1“.** Keď `get_paragraph` uvedie
  „odsek nie je číslovaný“, cituj tak, ako odporučí („§ N písm. x)“, alebo len „§ N“,
  keď odsek nemá písmená).
- **Prílohy a poznámky sú na konci znenia.** `get_version` / `save_law_markdown` vracajú
  telo predpisu, potom „PRÍLOHY“ a „Poznámky pod čiarou“. Pri predpisoch s veľkými
  prílohami (145/1995 ≈ 443 000 znakov) prvé okno prílohy neobsahuje — dočítaj okná, kým
  nie je `MCP_WINDOW_COMPLETE: true`, a pri `save_law_markdown` skontroluj
  `MCP_TEXT_TRUNCATED`. Príloha, ktorú Slov-Lex má len v PDF, je v texte iba ako odkaz
  „len ako PDF“ — jej obsah treba otvoriť z uvedenej URL.
- **Paragraf citovaný v novele nie je paragrafom novely.** Ak `get_paragraph` povie, že
  „§ N je iba citovaný text novelizačného bodu“, zavolaj ho pre novelizovaný zákon, ktorý
  hláška uvedie, s dátumom od účinnosti novely.
- **Súvisiace odkazy nie sú úplný zoznam.** `get_paragraph` pripája paragrafy toho istého
  zákona len vtedy, keď odkaz jednoznačne patrí jemu; „§ N“ vo vete, ktorá cituje iný zákon
  (napr. „§ 4 …, § 13 … a úľavy podľa § 16 zákona č. 366/1999“), vynechá. Ak potrebuješ
  istotu, prečítaj text ustanovenia sám.
- **„Slov-Lex nemá znenie tohto predpisu“** pri odkaze na iný zákon znamená, že k dátumu
  nie je jeho znenie (typicky zrušený predpis), nie výpadok — zadaj starší `date`.
- **Kontrola desiatok citácií naraz:** jedným volaním `save_law_markdown` ulož celé
  znenie a over citácie cez `read_saved_markdown`, nie paragraf po paragrafe.
- **Slov-Lex je verejný portál bez zmluvného API.** Zmena štruktúry stránky môže
  dočasne rozbiť parsovanie — skús neskôr.
- **Dôvodová správa nie je k dispozícii ku každému predpisu**, najmä pri starších —
  chýbajúci výsledok neznamená, že správa neexistuje.
- **`resolve_lp` pozná len aktuálne legislatívne materiály.** Pri staršom zákone vráti
  zoznam noviel označených `NOVELA` a nič nevyberie — dôvodová správa novely nevysvetľuje
  pôvodný zákon. Volanie trvá 10–20 s (zoznam eLegislatívy je veľký).
- **Self-hosted OAuth režim podporuje jednu repliku** — OAuth stav je v jednom súbore
  (`/data/oauth-state.json`), uložené exporty sú v adresári na samostatnom
  volume (`/data/exports`). Ani jedno nie je distribuované naprieč replikami,
  takže pri viacerých replikách by si save/read nemuseli sedieť.

## Autorizácia

Lokálny plugin používa `stdio` a nepotrebuje HTTP autentifikáciu. Voliteľný self-hosted
HTTPS režim podporuje OAuth 2.1 s PKCE; pri prvom pripojení môže klient otvoriť
prehliadač, vyžiadať autorizačné heslo a následne jednorazový súhlas viazaný na danú
požiadavku. Operátor musí uložiť `OAUTH_AUTHORIZATION_PASSWORD` mimo Gitu a overiť
celý flow so skutočným klientom.

## Inštalácia v LAWOSS

Pribalený lokálny runtime a CLI vyžadujú Node.js 22.14+ a npm. Prvý štart nainštaluje uzamknuté závislosti; ďalšie štarty použijú vyrovnávaciu pamäť. Podrobnosti a obmedzenia sú v README pluginu.
