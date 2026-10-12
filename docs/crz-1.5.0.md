# CRZ 1.5.0 acceptance

Source: `Omni-Legal-Products/mcp-crz` commit `d733296b3b22abdf3650e6c152accd11657e5e60` (PR #1 into `codex/lawoss-release-2026-09-05`), cherry-picked from the personal upstream fix 1.4.0.

- Fix: `crz_whats_new` no longer reports "nothing new" after one page without new ids. It scans by publication date, returns `complete`, `truncated`, `warnings` and `max_datum`; a `since_id`-only check is never marked complete.
- Fix: `ico` now queries both sides of the contract (`art_ico` supplier, `art_ico1` contracting authority) and merges the rows (`ico_zhoda`). Added optional `ico_dodavatel` and `ico_objednavatel`.
- Fix: paging no longer skips rows when `limit` is not a multiple of 20 (`next_offset`, optional input `offset`). Invalid dates are an error instead of a silently dropped filter. `total_pages_hint` is set only when exact (`total_pages_at_least` otherwise). `crz_recent.max_id` counts returned rows only.
- Fix: `crz_get_contract` keeps "Popis predmetu zmluvy", "Poznámka" and the ÚVO link; unknown labels are reported in `ine_polia` and `warnings`.
- Fix: `crz_extract_clauses` segments by article headings and reports unreliable extraction in `warnings`; a missing category is not presented as a missing clause.
- Catalog skill: monitoring via `max_datum` → `since_date`, new pitfalls for the changes above.
- Contract: only optional inputs and output fields were added; behaviour changes are listed in the source CHANGELOG 1.4.0.
- Source tests: 106 passed (86 before); TypeScript build passed. Regression tests run on pages captured from crz.gov.sk on 2026-10-09 with natural persons, IBAN and DIČ anonymized.
- Catalog: 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed.
- Packaged runtime smoke (stdio, live CRZ read, 2026-10-12): 10 tools; `crz_search` with `ico` 00320650 returned the municipality's purchases (12915089, 12915087) tagged `ico_zhoda: objednavatel`; `crz_whats_new` with `since_date` 2026-10-08 returned 2 rows with `complete: true`.

Not verified here: the Codex `plugin-creator` validator, isolated Git-marketplace install/update/rollback, Windows and Linux.

Tests establish search, paging and parsing behaviour for the captured pages and the selected live reads. They do not establish the legal content or validity of any contract.
