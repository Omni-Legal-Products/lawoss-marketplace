# OV 1.2.1 acceptance

Source: `Omni-Legal-Products/mcp-obchodny-vestnik` commit `41177404d26dc0d64ae92da316a4decadadbc89c` (PR #7, fast-forwarded into `codex/rollout-fix-ov`). Same server code as 1.2.0; only locked dependencies changed.

- Security: `npm audit fix` within the declared ranges. `@modelcontextprotocol/sdk` 1.29.0 → 1.32.1 (GHSA-6qxp-vccf-f47h), `proxy-addr` 2.0.8, `fast-uri` 3.1.8, `ip-address` 10.7.4. `npm audit` and `npm audit --omit=dev` report 0 vulnerabilities; the source CI failed on them before.
- Source tests: 186 passed in 14 files including the organization contract tests; typecheck, build and documentation checks passed; source CI green.
- Packaged runtime smoke (stdio, live OV reads, 2026-10-12): 3 tools; page 2 of OV_KaV 2026, the empty insolvency group with warnings, 95 notices for IČO 35868856 and notice PDFs with text behaved as in 1.2.0.
- Catalog: 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed.
- Isolated acceptance: Codex install from `main` (1.2.0) → update to this branch (1.2.1) → rollback; Claude Code install of 1.2.1. Codex CLI 0.159.3 has no plugin validation command, and its `plugin-creator` 0.1.26 no longer ships `validate_plugin.py`, so the real Codex install stands in for that validator.

Tests establish behavior for the captured pages and selected live reads. They do not establish legal applicability or completeness of the gazette.
