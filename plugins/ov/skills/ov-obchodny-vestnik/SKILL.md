---
name: ov-obchodny-vestnik
description: Použi pri otázkach na verejné oznámenia v Obchodnom vestníku SR, dátum zverejnenia, konkurz, reštrukturalizáciu, likvidáciu, dražbu alebo exekúciu. Use for Slovak Commercial Gazette public notices and publication dates.
---

# OV — Obchodný vestník

## Kedy použiť

Použi tento skill, keď treba vyhľadať verejné oznámenie podľa mena, presne osemmiestneho IČO, značky, sídla, kapitoly alebo dátumu a potom overiť PDF detail. Nezamieňaj dátum zverejnenia s dátumom rozhodnutia alebo zápisu v ORSR.

## Postup

1. Pri presnom IČO použi `ov_get_by_ico`; pri inom kritériu použi `ov_search`.
   Pri otázke, či je subjekt v konkurze alebo reštrukturalizácii, over aj Register úpadcov — OV k tomu od 1. 10. 2025 nestačí.
2. Skontroluj `sourceValidated`, `retrievedAt`, `sourceTotal`, `truncated`, `truncationReason`, `warnings` a kapitoly.
3. Pre rozhodujúci záznam použi `ov_get_notice` s vráteným `idFormular`.
4. Cituj `sourceUrl` a dátum zdroja. Ak výsledok môže byť skrátený alebo PDF text neúplný, povedz to výslovne.
5. Nevydávaj technický výsledok za právny záver; pri osobe alebo právnickej osobe over aktuálne registračné údaje aj v príslušnom oficiálnom registri.

## Pasce

- **Prázdny insolvenčný výsledok z OV neznamená „nie je v konkurze“.** Kapitola `OV_KaR` nemá v zdroji oznámenie novšie ako 30. 9. 2025 (overené 9. 10. 2026); odpoveď to uvádza vo `warnings`. Novšie konania over v Registri úpadcov. Je to pozorovaný stav zdroja, nie právny záver.
- **Skupina `insolvency` neobsahuje `OV_DOch` (Dočasná ochrana)** — ak je relevantná, hľadaj ju cez `kapitola: "OV_DOch"`.
- **`returnedCount` je počet na vrátenej strane.** `truncated` hlási ďalšie strany; `sourceTotal` je presný len na poslednej strane. `kapitolaDetail.rowCount` a `newest` sú zo strany, `pageCount` a `truncated` hovoria o zvyšku kapitoly.
- **`ov_get_notice` číta polia len z označenej hlavičky.** Pri oznámeniach súdu bez hlavičky ostane `subjekt` prázdny a dlžník, súd či IČO sú len v `text` — nepreberaj údaje iného subjektu (advokát, správca, navrhovateľ).
- **Chyba nie je „nenájdené“.** `OV_SCHEMA`, `OV_HTTP` a ďalšie typované chyby znamenajú, že sa nič nezistilo.

## Kontrakty a limity

- `ov_search`: aspoň jedno hlavné kritérium; IČO má presne 8 ASCII číslic.
- `ov_get_notice`: kladné celé `idFormular`; detail musí po najviac jednom rovnakom-origin presmerovaní skončiť ako PDF.
- `ov_get_by_ico`: najviac 20 strán a 2,000 riadkov.
- WebForms HTML a PDF: 512 KiB; extrahovaný text: 128 KiB; pole: 8 KiB.
- Typované chyby: `OV_INPUT`, `OV_HTTP`, `OV_TIMEOUT`, `OV_CONTENT_TYPE`, `OV_SCHEMA`.

Lokálne MCP beží cez `stdio`; remote režim musí byť fail-closed OAuth alebo bearer, prípadne výslovne povolený anonymous. Tieto transportné režimy nemenia význam dát.

*English summary: choose `ov_search`, `ov_get_by_ico`, or `ov_get_notice` by task; stdio is local, while remote authentication is fail-closed OAuth or bearer.*

## Hranice

PDF extrakcia je best-effort a nerobí OCR. `retrievedAt` vyjadruje aktuálnosť (freshness) načítania, nie právny účinok. Obchodný vestník nie je ORSR ani Register úpadcov. Výstup nie je právnym poradenstvom.

*English summary: limits are 512 KiB per HTML/PDF response and 20 pages / 2,000 rows; report truncation, support boundaries, and freshness rather than implying legal completeness.*

## English summary

Use `ov_search` for a bounded public query, `ov_get_by_ico` for exact eight-digit IČO pagination, and `ov_get_notice` for the selected PDF detail. Always report source time, truncation, warnings, and the canonical source link. HTML/PDF payloads are capped at 512 KiB and IČO traversal at 20 pages / 2,000 rows. Stdio, OAuth and bearer are transport choices; they do not establish freshness or legal meaning. This tool is not legal advice.

## Inštalácia v LAWOSS

Pribalený lokálny runtime a CLI vyžadujú Node.js 22.14+ a npm. Prvý štart nainštaluje uzamknuté závislosti; ďalšie štarty použijú vyrovnávaciu pamäť. Podrobnosti a obmedzenia sú v README pluginu.
