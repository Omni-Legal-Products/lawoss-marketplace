# EUR-Lex CELEX 1.2.0 acceptance

Source: `Omni-Legal-Products/mcp-eurlex` commit `3c397229e0615e1d8c80a554c37ed7e07fd6c5a6` (PR #3 into `codex/lawoss-release-2026-09-05`), carrying the audit fixes of 2026-10-09 from the upstream repository (source package version 1.1.0).

- Fix: `eurlex_document_versions` used CELLAR predicates that do not exist and returned only the original act. It now lists amending acts (with entry-into-force date), corrigenda and the act's own consolidated texts, with OJ references.
- Fix: `eurlex_related_find` always returned 0 documents. It now covers legal basis, amendments, national transposition measures and repeals, filters before the limit and reports `totals` and `truncated`.
- Fix: `eurlex_eli_resolve` failed in both directions; the ELI is now read from `cdm:resource_legal_eli`.
- Fix: `eurlex_celex_validate` returns title, publication date, ELI and a readable OJ reference (classic issue and act-by-act OJ since October 2023).
- Fix: `eurlex_document_export` returned 404 for PDF/A, XHTML and Formex. Formex 4 is saved as the complete `.zip` package.
- Fix: `eurlex_citation_check` picks the earliest of several entry-into-force dates deterministically (1.1.1 used `LIMIT 1` without ordering) and lists all of them; `9999-12-31` is shown as open-ended.
- Fix: CELEX type codes A, C, J, K, S (K/S were swapped), added O and Y; two-digit case numbers; corrigenda and national measures labelled; `eurlex_document_compare` honours `max_chars` and diffs same-language texts; `eurlex_document_find` reports the 200-match cap.
- Output contract: `eurlex_document_export` with `format="xml"` now writes a `.zip`; new fields `totals`, `truncated`, `manifestationType`, `sourceUrl`, `datesEntryIntoForce`.
- Skill: new sections *Osvedčené postupnosti* and *Pasce*.
- Source tests: 81 passed (including the organization contract tests); TypeScript build passed. 35 new regression tests replay responses captured from the live CELLAR SPARQL endpoint and fail on the previous source.
- Catalog: 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed. The Codex plugin-creator validator was not run while preparing this release and still has to run.
- Packaged runtime smoke (stdio, live CELLAR read, 2026-10-12): 12 tools; AI Act on 2024-07-01 `not_in_force` (entry into force 2024-08-01); GDPR ELI resolved; Directive 95/46/EC `repealed_by` 32016R0679; Directive 93/13/EEC versions with two amendments; GDPR SK exported as PDF/A.

Pending before merge: Codex plugin-creator validator and isolated Git-marketplace install/update/rollback acceptance.

Tests establish behavior for the captured CELLAR data and selected live reads. They do not establish legal applicability or the completeness of EUR-Lex data.
