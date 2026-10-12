# RÚZ 1.3.0 acceptance

Source: `Omni-Legal-Products/mcp-ruz` commit `629e917b0db60fdc83f478cc40f42b1d591485bf` (PR #7 into `codex/lawoss-release-2026-09-05`), cherry-picked from the reviewed personal source of truth.

- Fix: indicator mapping verified against all 245 templates of `/api/sablony`. On Úč ROPO and consolidated public-sector filings `equity` took "VLASTNÉ IMANIE A ZÁVÄZKY", the pasíva total. For Bratislava 2024 that reported 1 760 160 811.34 where r. 116 holds 1 259 650 034.44.
- Fix: `revenue` on Úč NUJ, ROPO, Kons. UJ VS and Úč SP sums own products, services and goods (the components of ROPO subtotal r. 65). Plugin 1.2.0 summed services only.
- Fix: `liabilities` takes only the total row. Úč NUJ 2013 and Úč SP have none and now report `available: false` instead of a sub-item such as "Záväzky z nájmu". `assets` and `profit` are now found on Úč NUJ, ROPO and Úč SP.
- Fix: an empty row is reported in `note` instead of being treated as zero, and sums of amounts with cents stay on whole cents.
- Added: `ruz_get_report` returns the leading columns of four-column tables (`brutto`/`korekcia`, `hlavnaCinnost`/`podnikatelskaCinnost`, `nezdanovanaCinnost`/`zdanovanaCinnost`), named from the template header. `ruz_download_attachment` reports an HTML outage page as unavailability. The HTTP server refuses `savePath`.
- Source tests: 96 passed, including the organization contract tests and 14 new regressions on captured RÚZ responses. TypeScript build passed.
- Catalog: 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed.
- Packaged runtime smoke (stdio from an unrelated working directory, `scripts/run.mjs mcp`, live RÚZ read, 2026-10-12): 8 tools. Bratislava 2025 equity 1 264 077 601.67 (r. 116) and revenue 27 230 309.41. Slovensko.Digital assets 120 360 and profit 3 443. Alza unchanged at 617 457 271. `ruz_get_report` returns brutto 143 844 758 and korekcia 17 218 338.

Not run: the Codex plugin-creator validator. The installed plugin-creator (0.1.26) ships no `validate_plugin.py`.

Tests establish behavior for the captured responses and a selected live read. They do not establish accounting or legal correctness of the indicator definitions.
