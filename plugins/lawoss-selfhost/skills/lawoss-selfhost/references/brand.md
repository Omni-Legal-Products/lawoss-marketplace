# Balík značky

Balík značky určuje, ako vyzerá prihlásenie, aktivácia účtu a súhlas: názov,
logo, farby a písma. Neobsahuje tajomstvá. Bez vlastného balíka sa použije
predvolený balík LAWOSS, ktorý je určený iba pre používateľov LAWOSS.

## Čo potrebuješ od človeka

- logo vo formáte SVG (vektor). Ak má človek iba PNG alebo JPG, požiadaj
  o SVG od jeho grafika; obrázok svojvoľne neprekresľuj;
- názov, ktorý sa zobrazí (napríklad „Advokátska kancelária Príklad“), a ako
  sa volá účet („účet kancelárie“);
- jazyk rozhrania: `sk`, `cs`, `en` alebo `de`;
- farby ako hex kódy, ak ich má (inak navrhni z loga a daj ich schváliť);
- potvrdenie, že logo, názov aj farby smie použiť.

## Obsah priečinka

Priečinok má názov z malých písmen, číslic a pomlčiek (napríklad
`kancelaria`); nesmie sa volať `default` ani `lawoss`. Obsahuje:

- `brand.json` (povinný);
- `logo.svg` (povinné), voliteľne `logo-dark.svg` pre tmavé pozadie a `mark.svg`;
- `tokens.css` (povinný) s farbami;
- voliteľne písma `.woff2` s licenciou, ktorá ich dovoľuje použiť na webe.

Pravidlá kontroly v obraze auth: každý súbor najviac 512 KiB; SVG bez
skriptov, `foreignObject`, obsluhy udalostí, entít a odkazov `javascript:`;
CSS bez `@import` a bez načítania z iných adries; farby v tvare `#1A2B3C`;
hlavná farba `primary` musí mať kontrast aspoň 4,5 : 1 voči bielemu textu
tlačidla. Ak sa uvedie `colors`, musí obsahovať všetkých šesť farieb.

`brand.json`:

```json
{
  "productName": "Advokátska kancelária Príklad",
  "accountLabel": "účet kancelárie",
  "locale": "sk",
  "assets": {
    "logo": "logo.svg",
    "logoSize": { "width": 182, "height": 42 },
    "fonts": [],
    "tokens": "tokens.css"
  },
  "colors": {
    "primary": "#1F3A5F",
    "primaryDeep": "#14263F",
    "accent": "#B98D3F",
    "ink": "#0A0E14",
    "surface": "#F7F5F0",
    "line": "#42586E"
  }
}
```

`logoSize` je veľkosť loga v pixeloch (celé čísla najviac 1024); zachovaj
pomer strán loga.

`tokens.css` nastavuje premenné, ktoré číta spoločný štýl prihlásenia:

```css
:root {
  --color-violet-500: #1F3A5F;
  --color-violet-900: #14263F;
  --color-mint-300: #B98D3F;
  --color-ink-950: #0A0E14;
  --color-lavender-50: #F7F5F0;
}
:root body,
:root .form-panel {
  background: #F7F5F0;
}
```

## Postup

1. Priečinok priprav na počítači, kde beží agent, a skopíruj ho na server do
   domovského priečinka používateľa (napríklad `scp -r`).
2. Skontroluj ho a ukáž náhľad (krok 8 v `SKILL.md`):
   `brand check "$HOME/kancelaria"` a `brand preview "$HOME/kancelaria"`.
   Pred `init` vyžadujú aj `--record ~/lawoss-0.2.0.json --record-sha256 …`;
   po `init` použijú obraz auth nasadenia.
3. Náhľad beží na serveri na `127.0.0.1:4317`. Človek si otvorí tunel
   `ssh -N -L 4317:127.0.0.1:4317 USER@SERVER` a v prehliadači
   `http://127.0.0.1:4317`. Náhľad zastaví Ctrl-C.
4. Po schválení a potvrdení práv: `brand set "$HOME/kancelaria"`. Balík sa
   skopíruje do `/opt/lawoss/brand/kancelaria` a auth sa reštartuje.

Ak `brand check` vypíše `FAIL`, oprav balík podľa pravidiel vyššie a skontroluj
ho znova; do `/opt/lawoss/brand` nič ručne nekopíruj.
