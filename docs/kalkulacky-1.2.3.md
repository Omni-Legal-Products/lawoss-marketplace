# Kalkulačky 1.2.3 acceptance

Source: `Omni-Legal-Products/mcp-kalkulacky-sk` commit `0845653617d1fd2d29665314427f0965d1c2d212` (merge of `feat/koniec-lehoty`). Runtime manifest SHA-256 `9d80b381daf30d16e0fc30835cf27439f497370c265343dabbe50ce191743e2c`.

- **Feature (lawoss#432):** new tool `koniec_lehoty` computes the last day of a procedural deadline (CSP, SSP, delivery to the e-mailbox under § 32 of Act 305/2013) with every step, the legal basis and later alternative readings in `alternativy[]`. It ships the bundled holiday table `runtime/data/dni-pracovneho-pokoja.json` (Act 241/1993 per Slov-Lex as of 16 November 2026). The source moves to zod 4.
- **Skill:** the catalog skill takes the source skill change from 5ff45d0 to 0845653 (when and how to use `koniec_lehoty`, ask for the delivery date instead of guessing it, offer to record the deadline only with consent and the label „overiť“). The catalog's LAWOSS install section is kept.
- **Packaging:** rebuilt with `scripts/package_runtime.py` (Node 24.22.1, esbuild 0.28.1 from the source lock file). The runtime has 11 files; the plugin has 21 files and 1,570,420 bytes in total, the largest file being the 1,458,081-byte bundle `runtime/dist/src/server.js` (previously 808,614 bytes). All files match the app installer extension and file-count contract.
- **Source checks (packager):** `npm ci`, `npm run build` and `npm test` with 318 tests passed.
- **Catalog checks:** Python tests, `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed. The reviewed digests of the bundle and its notices in `scripts/validate.py` were renewed. Their URL scan hits match the previous bundle; the only new hostname-shaped hit is the zod 4 property access `def.local`, not a host.
- **Packaged runtime smoke (launcher CLI, isolated `LAWOSS_STATE_DIR` and `LAWOSS_CACHE_DIR`, 2026-11-16):** `doctor` reported commit 0845653; `tools` listed 6 tools including `koniec_lehoty`; `koniec_lehoty` for a 15-day deadline from 12 November 2026 returned 27 November 2026 with `overit: true`.
- **Codex gate:** not run for this candidate.

Tests establish technical behaviour, not the legal correctness of the result.
