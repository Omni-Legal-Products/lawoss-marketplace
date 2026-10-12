# RPO 0.2.0 acceptance

Source: `Omni-Legal-Products/mcp-rpo` commit `53033548a30a105e45b8a5a883632f420612581b` (PR #1 into `codex/lawoss-release-2026-09-05`), carrying the fixes from the 2026-10-09 audit and an `npm audit fix` of the runtime lockfile (@modelcontextprotocol/sdk 1.32.1, proxy-addr 2.0.8, hono 4.13.13, ip-address 10.7.4, fast-uri 3.1.8; 0 vulnerabilities).

- Fix: with `showHistoricalData=true`, statutory body members and business activities carry `validTo`; a former chairman is no longer indistinguishable from current members.
- Fix: dissolution is reported. `rpo_search` and `rpo_get_entity` return `termination`; the detail adds `legalStatuses` and a `note` for a dissolved entity. A last name or address that is no longer valid carries `nameValidTo` / `addressValidTo`.
- Fix: the register returns at most 500 rows and no total. `rpo_search` flags this with `countIsLowerBound` and no longer claims the register found 500 matches; `truncated` is `true` whenever the cap is hit, including `limit: 500`.
- Added: `rpo_get_entity` returns sections it used to drop silently: `stakeholders` (supervisory board, procurators, partners, shareholder), `authorizations`, `equities`, `shares`, `deposits`, `otherLegalFacts`, `predecessors`, `successors`. A large a.s. with history is roughly 180 kB of JSON.
- Fix: HTTP 5xx is no longer diagnosed as an overly broad query; IČO → id resolution only accepts a hit whose IČO matches. The catalog skill gained the matching sequences and pitfalls.
- Source tests: 134 passed, including the organization documentation contract; TypeScript build passed. 28 regression tests run on captured RPO responses with natural persons anonymised.
- Catalog: 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed. The Codex plugin-creator validator was not available in the preparing environment and still has to run.
- Packaged runtime smoke (stdio, live RPO read, 2026-10-12): 3 tools; entity 992140 returned `termination` 2010-07-01, both legal statuses, the note and the successor; entity 994963 with history returned 157 board records, 147 with `validTo`; `rpo_search` with only `limit` was rejected locally; `rpo_get_related` 992140 returned `termination` and the successor.

Pending before merge: Codex plugin-creator validator and isolated Git-marketplace install/update/rollback acceptance.

Tests establish behavior for the captured responses and a selected live read. They do not establish the legal correctness of register data.
