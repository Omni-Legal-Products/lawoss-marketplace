# `lawoss-paper-research` — návrh do marketplace

**Stav: pracovný návrh v samostatnom PR. Nie je to installovateľný plugin ani schválené vydanie.** Návrh zostáva mimo `plugins/`, oboch katalógov a `releases.json`; nevytvára MCP konfiguráciu ani záznam `AVAILABLE`.

Tento materiál dokončuje návrh skillu a jeho syntetický akceptačný test pred rozhodnutím o zaradení. Obsah vychádza z experimentálneho návrhu v koordinačnom repozitári na zaznamenanom commite [`c12cbc7d55afaf3c5503726bdb50afee27888055`](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/tree/c12cbc7d55afaf3c5503726bdb50afee27888055); tento odkaz sám osebe nepotvrdzuje release approval.

## Súbory návrhu

- [`SKILL.md`](SKILL.md) — trigger, bezpečnostná brána, metodika, právne zdroje, limity a výstupný formát.
- [`synthetic-test.md`](synthetic-test.md) — pozitívny test, dve negatívne kontroly a pozorovateľné kritériá.

Tlaková kontrola pri návrhu odhalila tri podstatné hranice: nečítať klientsky materiál pred rozhodnutím o bezpečnosti, nevymýšľať zdroje pri nedostupnom konektore alebo plnom texte a neaktivovať paper-research pre samostatnú citáciu či znenie ustanovenia. Táto kontrola bola desk review návrhu, nie empirický beh vydaného pluginu.

## Podmienka ďalšieho postupu

Pred zaradením do marketplace treba určiť release-approved organizančný zdroj a jeho presný commit, dokončiť príslušnú release gate a až potom pripraviť samostatný wrapper. Tento PR nemení existujúci katalóg a žiada review samotného obsahu skillu a testu.
