# Judikáty 1.2.2 acceptance

Source: `Omni-Legal-Products/mcp-judikaty-sk` commit `72ddb64454c35e72cabc75dbee249e90e42512b6` (PR #3 into `codex/lawoss-release-2026-09-05`). Runtime manifest SHA-256 `d470ba3022fc58b24d18d8ddc101ad473f7bce4b5dc38f8da475135dae6fe143`.

Source change: the operator's weekly status e-mail marks text-derived and model-estimated outcomes as estimates and no longer states estimated reversals as facts in its subject (audit 2026-10-09, J2). That script is not part of the packaged runtime. In this plugin, only the advertised server version changes (`dist/src/server/config.js`). The release keeps the catalog record aligned with the source release branch.

Verification:

- **Source:** `npm ci`, `npm run check`, `npm run build`, and `npm test` with 895 tests (882 passed, 0 failed, 13 live tests skipped). The builder reran the source tests.
- **Catalog:** 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed.
- **Packaged runtime smoke (stdio, live read, 2026-10-12):** `doctor` reported commit 72ddb64, and `resolve_decision_identity` "15Co/134/2024" returned the decision's own number.
- **Codex gate:** Codex CLI 0.162.1 has no plugin-creator validator, so the isolated install acceptance from `docs/RELEASES.md` ran (2026-10-12):
  - install from `main` gave 1.2.1;
  - with the ref set to `release/judikaty-1.2.2`, the updater reported `updated 1.2.1 -> 1.2.2`, the installed runtime reported commit 72ddb64, and `resolve_decision_identity` "5Co/1/2020" returned the ambiguity result;
  - with the ref set back to `main`, the updater reported `updated 1.2.2 -> 1.2.1` and `doctor` reported commit 5889b72.

Tests establish technical behaviour, not legal correctness.
