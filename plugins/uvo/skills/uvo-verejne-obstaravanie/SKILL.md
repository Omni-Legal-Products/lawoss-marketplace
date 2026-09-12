---
name: uvo-verejne-obstaravanie
description: Použi pri otázkach na verejné zákazky vo Vestníku ÚVO, obstarávateľa, tender, CPV alebo oznámenie; uses the read-only uvo_search, uvo_get_notice and uvo_get_contracting_authority MCP tools.
---

# ÚVO — verejné obstarávanie

## Inštalácia

Očakávaj lokálny stdio server z node dist/server.js alebo vlastný HTTPS remote POST /mcp. Remote musí mať explicitný oauth, bearer alebo schválený anonymous režim.

**English summary.** Use the portable stdio launcher or an explicitly authenticated self-hosted remote endpoint.

## Autentifikácia

OAuth používa PKCE S256, jeden worker a trvalý mode-0600 store. Bearer token je alternatíva. Anonymous je povolený iba s MCP_AUTH_MODE=anonymous a MCP_ALLOW_ANONYMOUS=true. Nikdy si nepýtaj ani nezapisuj heslo, token, cookie alebo OAuth state.

**English summary.** Authentication fails closed; never collect or expose credentials.

## Nástroje a kontrakty

1. uvo_search: použi aspoň jedno z ico, authorityName, contractName, cpv, nuts; voliteľne contractType, updatedWithinDays, page.
2. uvo_get_notice: použi číselný noticeId z dôveryhodného kontextu; vráti obstarávateľa, predmet a kanonický sourceUrl.
3. uvo_get_contracting_authority: použi presne osemmiestne ASCII ico; limit je 1–2,000 a agregácia má strop 20 strán/2,000 riadkov.

Vždy skontroluj sourceValidated, retrievedAt, truncated, truncationReason, warnings. Chyby UVO_INPUT, UVO_HTTP, UVO_TIMEOUT, UVO_CONTENT_TYPE, UVO_SCHEMA neinterpretuj ako nulový výsledok.

**English summary.** Preserve the exact three tool names and treat truncation/error metadata as part of every conclusion.

## Limity a právna hranica

Zdrojom je meniace sa HTML. Odpoveď je 512 KiB, pole 8 KiB, upstream concurrency 4. Prázdna odpoveď je platná iba s overenou tabuľkou a explicitným počtom. Oznámenie nie je uzavretá zmluva a technický výstup nie je právnym poradenstvom; pre zmluvu použi CRZ a pre subjekt ORSR.

**English summary.** HTML is unstable, output is bounded, and a procurement notice is neither a signed contract nor legal advice.

## Podpora

Pri chybe uveď tool, typovaný kód, čas a redigovaný popis; neprikladaj raw URL s query, body, hlavičky, cookie, IP, cesty ani výnimku. Pozri SUPPORT.md a SECURITY.md.

**English summary.** Report only redacted technical context and use the repository support/security process.

## Inštalácia v LAWOSS

Pribalený lokálny runtime a CLI vyžadujú Node.js 22.14+ a npm. Prvý štart nainštaluje uzamknuté závislosti; ďalšie štarty použijú vyrovnávaciu pamäť. Podrobnosti a obmedzenia sú v README pluginu.
