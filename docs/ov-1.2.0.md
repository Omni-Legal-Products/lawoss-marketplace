# OV 1.2.0 acceptance

Source: `Omni-Legal-Products/mcp-obchodny-vestnik` commit `4d15084fe1cf2b6f3df5df6b7f99741914ad47c7` (branch `fix/audit-2026-10-09-release`, PR #6 into `codex/rollout-fix-ov`). The fixes come from the MCP audit of 2026-10-09 and were made first in the maintainer upstream.

- Fix: `page` works. Further pages are a postback of the source's pager with the result page's ViewState; page 2 used to return page 1's rows. Added `pageCount`; `sourceTotal` is exact on the last page only (the source prints no total); a page past the last one is `OV_INPUT`.
- Fix (regression of 1.1.0): a search with no rows was always `OV_SCHEMA` because the synthetic empty fixture had a total label the live site does not render. Zero rows are a clean result only on the source's own "nevyhovujú žiadne údaje" sentence; an error page stays an error.
- Fix: `date` sends the radio value `rbDatumZverejneniaDen`; the source used to ignore the date filter.
- Fix: `ov_get_notice` returned `OV_SCHEMA` or `OV_CONTENT_TYPE` for every notice. Text is decoded through the fonts' ToUnicode CMaps (Type0/Identity-H). The bounded inflate failed on the source's streams, whose zlib header declares an 8 KiB window while the data reaches further back. PDFs served as `application/octet-stream` with a `%PDF-` signature are accepted. Fields come only from labeled header lines, so the attorney's address is no longer returned as the debtor's seat; an IČO written with spaces is normalized.
- Fix: all 37 live chapter codes are accepted (`OV_DOch` was rejected as invalid input).
- Added: `warnings` also when every chapter of a group is empty. The OV_KaR chapter has no notice newer than 30.09.2025 (observed on the live source, verified 2026-10-09); searches covering it, including `ov_get_by_ico`, say so and point to the insolvency register. This records the state of the source, not a legal conclusion. `OV_DOch` is not part of the `insolvency` group, and the warning mentions it. `kapitolaDetail[]` gained `pageCount` and `truncated`.
- Catalog skill: pitfalls for OV_KaR, OV_DOch, paging and header-only notice fields. `scripts/validate.py` pins the reviewed `ov` `dist/mcp-server.js` again (JavaScript identifiers in it resemble hostnames to the private-host scan).
- Source tests: 186 passed in 14 files, including the organization contract tests; new regression tests run on anonymized pages and a PDF captured from obchodnyvestnik.justice.gov.sk. TypeScript typecheck and build passed.
- Packaged runtime smoke (stdio, live OV reads, 2026-10-12): 3 tools, server version 0.2.0; page 2 of OV_KaV 2026 returned K000062…, different from page 1; IČO 45463671 with `kapitolaGroup: insolvency` returned 0 rows with the empty-group and OV_KaR warnings; `OV_DOch` returned rows; IČO 35868856 returned 95 notices; notices 4471526, 4770405 and 2834958 returned text, and the last two returned the debtor's name, seat and IČO.
- Catalog: 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed. The Codex plugin-creator validator was not available in the preparing environment and still has to run.

Pending before merge: Codex plugin-creator validator, isolated Git-marketplace install/update/rollback acceptance, and fast-forwarding `codex/rollout-fix-ov` to the recorded commit.

Not covered: notices without a labeled header keep an empty `subjekt` (the debtor is in `text` only); letter-spaced words keep their spaces; scanned PDFs without a text layer are an error.

Tests establish behavior for the captured pages and selected live reads. They do not establish legal applicability or completeness of the gazette.
