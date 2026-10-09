# Slov-Lex 1.1.2 acceptance

Source: `Omni-Legal-Products/mcp-slovlex` commit `3a7686c07e904315c0ed9f1d2fe0ea4b482f5bad` (PR #4 into `codex/lawoss-release-2026-09-05`).

- Fix: a paragraph whose single odsek is unnumbered in the official text (empty `odsekOznacenie`, e.g. § 10 of 215/2019 Z. z.) is no longer rendered with an invented "(1)", which had produced citations such as "§ 10 ods. 1 písm. a)".
- Fix: version headers state "Účinnosť tohto znenia"; `ucinnyDo` ends the consolidated version, not the law. When a later version is already published, the header names its date and IRI.
- Added: `get_paragraph` flags unnumbered odseky with a citation hint and provisions marked `toBeModified` / `toBeDeleted`. The catalog skill gained the matching pitfalls.
- Source tests: 96 passed; 8 organization contract tests passed; TypeScript build passed. Seven new regression tests cover the parser, the citation hint, the version probe and the MCP response.
- Catalog: 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed. The Codex plugin-creator validator was not available in the preparing environment and still has to run.
- Packaged runtime smoke (stdio, live Slov-Lex read, 2026-10-09): 10 tools; `get_paragraph` 215/2019 § 10 returned the unnumbered text, the citation hint, the pending-change warning and the next version 2027-01-01.

Pending before merge: Codex plugin-creator validator and isolated Git-marketplace install/update/rollback acceptance.

Tests establish behavior for the captured HTML and a selected live read. They do not establish legal applicability or universal coverage of every Slov-Lex document structure.
