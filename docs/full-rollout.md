# Full local runtime rollout

All 15 plugins include reviewed local runtimes, usage skills and CLI access. A clean Codex profile installed every plugin and initialized 22 MCP servers. Live calls through Codex verified ORSR, ČNB and ADIS. Separate clean CLI calls verified source responses for DISQ, EUR-Lex document retrieval, Justice decisions, legal-rate data, ORSR, RPO, RPVS, RÚZ and Slov-Lex.

## Coverage

- CRZ: ten tools; live contract retrieval verified.
- FS: requires an operator's `FS_API_KEY`. Version 1.1.1 supports the current metadata array and VAT search formats; 95 source tests, an authorized metadata read and a VAT status query passed. Other dataset paths still need query-specific source validation.
- OV, RU and ÚVO: source compatibility repairs passed 163, 196 and 172 source tests respectively, plus live result queries. OV reports an unknown total explicitly when the source omits it; unknown pagination on a full page is treated conservatively.
- Judikáty: includes Justice, NS SR and ÚS SR providers. Some ÚS DMS paths require separate provider credentials; PDF text requires Poppler. Local indexes do not imply complete court coverage.
- Czech ARES and ČNB: live data verified without keys. ADIS always runs live SOAP.
- Czech ISIR: live event feed available; unverified debtor/person screening returns an explicit error.
- Czech sanctions: requires a populated, successfully refreshed database. The launcher rejects missing or older-than-seven-day refresh records and reports loaded sources.
- Czech DD and real estate: tools are discoverable, but calls return an explicit coverage error until their data and semantics pass acceptance.
- EU Registry: GB requires `CH_API_KEY`; Poland supports exact KRS identifiers only; DE/NL use GLEIF, whose coverage is not the entire national register.

## Context cost

The following numbers count compact JSON tool descriptions and input schemas using `o200k_base`. They are a reproducible estimate of schema size, **not** an exact reading of Codex's hidden prompt. Deferred tool discovery can keep schemas out of the initial prompt; response data and loaded skills add their own tokens later. Disabled MCPs contribute no active tool schemas.

| MCP | Tools | Schema tokens |
|---|---:|---:|
| crz | 10 | 2,110 |
| cz_adis | 3 | 647 |
| cz_ares | 9 | 1,681 |
| cz_cnb | 3 | 619 |
| cz_dd | 9 | 2,026 |
| cz_eu-registry | 2 | 491 |
| cz_isir | 3 | 658 |
| cz_realestate | 1 | 216 |
| cz_sanctions | 5 | 1,068 |
| disq | 2 | 383 |
| eurlex_celex | 12 | 6,941 |
| fs_opendata_mcp | 9 | 1,267 |
| judikaty | 24 | 4,787 |
| kalkulacky | 5 | 2,752 |
| orsr | 13 | 2,080 |
| ov | 3 | 597 |
| rpo | 3 | 1,042 |
| rpvs | 3 | 1,043 |
| ru | 3 | 774 |
| ruz | 8 | 1,032 |
| slovlex | 10 | 2,721 |
| uvo | 3 | 580 |

Total: 143 tools, approximately 35,515 schema tokens if all schemas are loaded. Czech services together account for approximately 7,406. Keep that plugin disabled until needed.

The command-line launcher does not load MCP schemas into a conversation merely by being installed. Tool outputs can still be large: use source-side limits and text windows.
