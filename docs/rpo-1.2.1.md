# RPO 1.2.1 acceptance

Source: `Omni-Legal-Products/mcp-rpo` commit `3a0231cbb9b594d9adda08c640d3b345635d6169` (PR #2, fast-forwarded into `codex/lawoss-release-2026-09-05`; source package version 0.2.1).

- Fix: RPO returns one partner's deposit of ESET, spol. s r.o. (IČO 31333532) twice as an identical record — seven deposits for six partners, summing to 170 800 EUR against a 140 000 EUR registered capital. ORSR (Sro 3586/B, read 2026-10-12) lists six deposits totalling 140 000 EUR. An identical repeated deposit is now counted once and the `note` says so; when valid deposits still do not add up to the valid registered capital, the `note` says to check ORSR. The catalog skill gained the matching pitfall.
- Source tests: 137 passed, including the organization documentation contract; TypeScript build and `npm audit --omit=dev` (0 vulnerabilities) passed. Three new regression tests run on the captured ESET response with natural persons anonymised and fail on the previous code.
- Catalog: Python tests, `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed. The Codex plugin-creator `validate_plugin.py` named in `docs/RELEASES.md` passed for `plugins/rpo` (run 2026-10-12 with the plugin-creator copy of a second local Codex profile; the default profile's copy ships no scripts).
- Isolated Codex install acceptance (2026-10-12, fresh `CODEX_HOME` and `LAWOSS_CACHE_DIR`): installed `rpo@lawoss` 1.2.0 from `main`; `update_plugins.py --apply` with `ref = "release/rpo-1.2.1"` reported `updated 1.2.0 -> 1.2.1`; the installed runtime reported source commit `3a0231cb` and `rpo_get_entity` 937053 returned six deposits totalling 140 000 EUR; switching back to `main` reported `updated 1.2.1 -> 1.2.0` and the runtime reported `53033548` with 3 tools.
- Packaged runtime smoke (stdio, live RPO read, 2026-10-12): entity 937053 returned six deposits, 140 000 EUR, and the duplicate note; entity 992140 still returned `termination` 2010-07-01.

Tests establish behavior for the captured responses and a selected live read. They do not establish the legal correctness of register data.
