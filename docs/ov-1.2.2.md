# OV 1.2.2 acceptance

Source: `Omni-Legal-Products/mcp-obchodny-vestnik` commit `c4037dce315b378447d6aa9fbde64a2177aed244` (PR #8, fast-forwarded into `codex/rollout-fix-ov`). It closes the last finding of the 2026-10-09 audit (C10, low).

- Fix: `idx` is the source's running row number (page 2 starts at 11). A row whose number cell is empty used to get its position as an invented number; it now gets 0, and the response envelope rejects that row as `OV_SCHEMA`.
- Source tests: 188 passed in 14 files including the organization contract tests, two of them new on captured source pages; typecheck, build, documentation checks and `npm audit` (0 vulnerabilities) passed.
- Packaged runtime smoke (stdio, live OV reads, 2026-10-12): 3 tools, server 0.2.2; page 2 of OV_KaV 2026, the empty insolvency group with warnings, 95 notices for IČO 35868856 and notice PDFs with text behaved as in 1.2.1.
- Catalog: 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed.
- Codex gate: isolated install from `main` (1.2.1) → update to this branch (1.2.2) → rollback, per `docs/RELEASES.md`; the installed Codex has no `validate_plugin.py`. Claude Code install of 1.2.2.

Tests establish behavior for the captured pages and selected live reads. They do not establish legal applicability or completeness of the gazette.
