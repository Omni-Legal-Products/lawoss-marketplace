---
name: crz-register-zmluv
description: Použi pri otázkach na zverejnené zmluvy verejného sektora, ich prílohy, klauzuly, sumy, strany alebo nové záznamy v Centrálnom registri zmlúv. Use for Slovak public contracts, CRZ clauses, attachments, comparable contracts, and CRZ monitoring.
---

# CRZ — Centrálny register zmlúv

## Prevádzková hranica

Tento skill neobsahuje prednastavený vzdialený endpoint. Používateľ si prevádzkuje
vlastnú inštanciu: lokálne cez `stdio`, alebo na vlastnej HTTPS doméne. Verejnosť
údajov v CRZ neznamená, že má byť verejne otvorený samotný MCP server. Každé
vzdialené nasadenie musí vyžadovať autentifikáciu; odporúčaný režim je OAuth.

Dokumentácia používa iba zástupnú URL `https://mcp.example.com`. Nikdy ju
nepovažuj za fungujúcu službu a nevymýšľaj inú prevádzkovanú adresu.

## Kedy použiť CRZ

- dohľadanie zmluvy alebo dodatku podľa predmetu, strany, IČO, sumy či obdobia;
- získanie metadát a originálnych príloh verejnej zmluvy;
- konverzia podporovaných PDF, DOCX alebo UTF-8 TXT príloh na Markdown;
- heuristické vybratie sankcií, platobných podmienok, ukončenia a iných klauzúl;
- porovnanie podobných verejných zmlúv alebo kontrola nových záznamov.

Na verejné obstarávanie pred podpisom použi ÚVO, na údaje o spoločnosti ORSR,
na konečných užívateľov výhod RPVS a na právny predpis Slov-Lex.

## Odporúčaný postup

1. `crz_search` zúži vec, obdobie a strany.
2. `crz_get_contract` overí metadáta a identitu záznamu.
3. `crz_contract_to_markdown` načíta podporovaný text a upozornenia.
4. `crz_extract_clauses` vyberie relevantné ustanovenia.
5. `crz_find_similar_contracts` rozšíri porovnávaciu vzorku.

Na monitoring použi `crz_recent`, ulož `max_id` a pri ďalšej kontrole ho odovzdaj
do `crz_whats_new` ako `since_id`.

## Lokálna registrácia

Po `npm ci && npm run build` zaregistruj absolútnu cestu k `dist/index.js`:

```json
{
  "mcpServers": {
    "crz": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-crz/dist/index.js"]
    }
  }
}
```

Pre vzdialenú inštanciu nakonfiguruj vlastnú URL
`https://mcp.example.com/mcp` a dokonči OAuth prihlásenie podľa klienta.

## Bezpečné používanie výsledkov

- Výsledok vždy spoj s CRZ ID/URL a over proti originálu.
- Heuristická extrakcia ani deterministický súhrn nie sú právnym stanoviskom.
- Prázdny text zo skenu nemusí znamenať prázdnu prílohu; skontroluj warning a originál.
- OCR posiela dokument externému poskytovateľovi iba vtedy, keď je zapnuté a má API kľúč.
- `save_path` zapisuje na filesystem servera; používaj iba kontrolovanú cestu.
- Nepodporované prípony sa dajú stiahnuť, ale vrátia
  `unsupported_attachment_type:<ext>` namiesto extrahovaného textu.
