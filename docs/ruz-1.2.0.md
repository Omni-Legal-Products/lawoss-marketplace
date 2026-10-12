# RÚZ 1.2.0 acceptance

Source: `Omni-Legal-Products/mcp-ruz` commit `780624b04b7e0dd833ec657b8af29a4f5bdaa991` (PR #6 into `codex/lawoss-release-2026-09-05`), cherry-picked from the reviewed personal source of truth.

- Fix: `revenue` on Úč POD from 2014 (template 699) sums r. 03 goods + r. 04 own products + r. 05 services; it previously summed r. 03 only, so a services company reported no revenue and a retailer lost its services. A row matched by two patterns is counted once; the new `rows` field lists the summed rows.
- Fix: entity resolution skips deleted records (`stav: ZMAZANÉ`), tells them apart from units in the non-public part (`stav: Neverejná`), returns `ambiguous` + `candidates` when one IČO carries several live units (new optional `entityId` input), and follows `existujeDalsieId` paging.
- Fix: `ruz_financial_profile` returns one row per accounting period. The row names the statement its figures come from (`statementId`, `typ`, `datumPodania`), and further statements for the period are listed in `otherStatements` with the selection rule in `note`. `years` counts periods.
- Fix: `templateName` is the template of the report that yielded the figures; `templateNames` lists all reports. The hint is derived from the whole statement (IFRS > VÚ POD > ancillary report) and covers reports with `pristupnostDat: Neverejné`. An all-IFRS profile states that `available: false` is not zero.
- Changed output: `entity.velkost` and `entity.pravnaForma` carry the RÚZ codelist labels; the codes moved to `velkostKod` and `pravnaFormaKod`.
- Source tests: 81 passed, including the organization contract tests and 19 new regressions on responses captured from the RÚZ API, 16 of which failed on the previous source. TypeScript build passed.
- Catalog: 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed. The Codex plugin-creator validator was not available in the preparing environment and still has to run.
- Packaged runtime smoke (stdio from an unrelated working directory, live RÚZ read, 2026-10-12): 8 tools, `entityId` exposed; Websupport 2025 revenue 13 148 139 (r. 05); Alza 2025/2024 617 457 271 / 539 442 883 with template „Úč POD“ and size „500-999 zamestnancov“; VW Slovakia one row per year with three further statements; IČO 99999999 two live candidates and one deleted record.

- Isolated Git-marketplace acceptance (2026-10-12, separate `CODEX_HOME` and `CLAUDE_CONFIG_DIR`): Codex installed `ruz@lawoss` 1.1.0 from `main`, `scripts/update_plugins.py --apply` updated it to 1.2.0 from `release/ruz-1.2.0`, the installed runtime started with `scripts/run.mjs mcp` and answered live RÚZ reads, and the same updater rolled it back to 1.1.0 from `main`. Claude Code installed 1.2.0 from `release/ruz-1.2.0` and the installed runtime answered the same reads.

Not run: the Codex plugin-creator validator. The installed plugin-creator (0.1.26) ships skills only and no `validate_plugin.py`.

Tests establish behavior for the captured responses and a selected live read. They do not establish accounting or legal correctness: the revenue composition is a mapping choice, and the primary-statement rule for duplicate periods is disclosed, not authoritative.
