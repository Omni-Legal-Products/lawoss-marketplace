# ÚVO 1.2.0 acceptance

Source: `Omni-Legal-Products/mcp-uvo` commit `d0138206b55338fcc82e63b31b658430751ef55f` (branch `fix/audit-2026-10-09-release`, PR into `codex/rollout-fix-uvo`). The fixes come from the MCP audit of 2026-10-09 and were made first in the maintainer upstream.

- Fix: search pages with the source parameter `page`. The source ignored `pageNo`, so page 2 returned page 1 and `hasNext` was always false. The server now checks the paginator echo (page, page size, IČO, contract type, update window).
- Fix: `contractType` sends `TOVARY`/`SLUZBY`/`PRACE`/`SUHRNY`; the legacy values are mapped. Every query with a contract type used to return no rows.
- Fix: 2014 award notices no longer report the CPV code 71311220 as the estimated value. Added `finalValue` and `awardedTo`; authority type and main activity are read by subsection title.
- Fix: eForms notices (2024+) are parsed instead of rejected with `UVO_SCHEMA`: type and subtype, the main buyer instead of ÚVO as eSender, subject, estimated value with currency, related contract.
- Fix: the source's explicit "no records" page is a valid zero. The same page after the source's own time limit (~30 s, observed live) is retried once, then `UVO_TIMEOUT`. New typed errors: `UVO_UNAVAILABLE` (outage redirect, outage page, HTTP 5xx), `UVO_NOT_FOUND`, `UVO_PAGE_OUT_OF_RANGE`.
- Changed: `uvo_search` accepts pages 1–1,000; authority aggregation pages by 50 rows (still at most 20 pages). Added output fields: `returnedCount`, `pagination.totalPages`, `formFamily`, `noticeSubtype`, `awardedTo`, `subject.finalValue`, `subject.mainCpvLabel`, `subject.placeNutsLabel`; a truncated notice field is reported in `warnings`.
- Source tests: 191 passed in 12 files, including the organization contract tests; tests now run on pages captured from uvo.gov.sk with natural persons anonymized. TypeScript typecheck and build passed.
- Packaged runtime smoke (stdio, live ÚVO reads, 2026-10-12): 3 tools, server version 0.2.0; notice 258144 returned 4,100,000 EUR estimated and 2,390,941.98 EUR final value with the winner; eForms notice 1410909 returned the buyer IČO 35919001 and 968,622.95 EUR; search page 2 for IČO 35919001 returned 1,150 records with different rows than page 1.
- Catalog: 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed. The Codex plugin-creator validator was not available in the preparing environment and still has to run.

Pending before merge: Codex plugin-creator validator and isolated Git-marketplace install/update/rollback acceptance.

Not covered: the 2016–2023 award-notice form (no captured fixture), the award section of eForms result notices (reported in `warnings`), a live outage (tested on the captured outage page only).

Tests establish behavior for the captured HTML and selected live reads. They do not establish legal applicability or universal coverage of every ÚVO notice form.
