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

1. **Na konkrétny paragraf:** `search` → `get_law` → `get_paragraph`.
2. **Na znenie k dátumu:** rovnaký postup, potom `get_version` s dátumom — bez neho
   príde aktuálne znenie.
3. **Na úmysel zákonodarcu:** `get_explanatory_reports` → `get_explanatory_report_text`.
4. **Na uloženie do spisu:** `save_law_markdown` alebo `save_explanatory_report_markdown`,
   spätné čítanie cez `read_saved_markdown`.

## Pasce

- **Bez dátumu dostaneš aktuálne znenie.** Pri spore o staršiu skutkovú situáciu to
  nesedí — treba explicitne zadať dátum.
- **Novely s delenou účinnosťou** menia rôzne časti predpisu k rôznym dňom; over
  výsledok voči originálu, nespoliehaj sa na jeden dátum pre celý predpis.
- **Slov-Lex je verejný portál bez zmluvného API.** Zmena štruktúry stránky môže
  dočasne rozbiť parsovanie — skús neskôr.
- **Dôvodová správa nie je k dispozícii ku každému predpisu**, najmä pri starších —
  chýbajúci výsledok neznamená, že správa neexistuje.
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
