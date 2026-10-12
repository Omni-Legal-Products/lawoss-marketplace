# EUR-Lex CELEX 1.2.1 acceptance

Source: `Omni-Legal-Products/mcp-eurlex` commit `e6c930f3b1a902c879431233c9466c443c694f7f` on `codex/lawoss-release-2026-09-05` (fast-forward), source package version 1.1.1, carrying upstream `originalmagneto/MCP-EURLEX-CELEX@dfd4731`.

- Fix: the MCP `serverInfo` version (and `/health` in HTTP mode) is read from `package.json`; 1.2.0 reported "1.0.0".
- Fix: CELEX numbers are validated before they are placed into a SPARQL query; quotes, braces and whitespace are rejected with an error instead of reaching CELLAR.
- Fix: `eurlex_document_get` and `eurlex_document_find` share one cached download regardless of CELEX letter case.
- Fix: `eurlex_search_full_text` no longer emits an empty CELEX with a dead link for results without one, and reports an entry-into-force date as `dateEntryIntoForce` rather than as the document date. Not verified against a live Web Service response (no credentials were used).
- Source plugin manifests now carry the source package version (1.1.1); the catalog version stays independent.
- Source tests: 86 passed (including the organization contract tests; 5 new tests fail on the previous source); TypeScript build passed.
- Catalog: Python tests, `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed. The Codex plugin-creator `validate_plugin.py` named in `docs/RELEASES.md` passed for `plugins/eurlex-celex` (run 2026-10-12 on catalog commit e0fb84a with the plugin-creator copies of the Codex app for Xcode and of a second local Codex profile; the default profile's plugin-creator 0.1.26 ships no scripts).
- Packaged runtime reports `serverInfo.version` 1.1.1 (the source version; the catalog version is 1.2.1).
- Isolated Git-marketplace acceptance (2026-10-12, a copy of `scripts/rehearse_update.py` and `scripts/check_codex.mjs` adapted from CRZ to this plugin, isolated `CODEX_HOME` and local HTTP Git fixture, runtime manifest `3f69afeb…`): install 1.2.1 → update to a marked fixture version → rollback to 1.2.1. Every stage loaded 12 tools, started warm without npm on `PATH`, and made a live read through the Codex app-server (`eurlex_celex_validate` 32016R0679 → ELI and "OJ L 119, 4.5.2016"). The update used a separate runtime cache and the rollback returned to the original one.

Tests establish behavior for the captured CELLAR data and selected live reads. They do not establish legal applicability or the completeness of EUR-Lex data.
