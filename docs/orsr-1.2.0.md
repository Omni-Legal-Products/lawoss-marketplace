# ORSR 1.2.0 acceptance

Source: `Omni-Legal-Products/mcp-orsr` commit `676cf2f4484bf3220ae32826749f1ae76bf544cd` (PR #1 into `codex/lawoss-release-2026-09-05`), runtime package 1.1.0.

Fixes to the derived tools `orsr_get_company_profile*` and `orsr_get_company_data*` after the 2026-10-09 audit. Tool names and input schemas are unchanged; output fields were only added.

- Fix: `od`/`do` of officers and partners is the registry-record period, not the term of office. The start and end of the function are now in `functionCreationDate` / `functionTerminationDate`, deletion records carry `registryDeletionRecord`, and `dateSemantics` explains the fields (Tatra banka chair: function since 2007-07-01, record since 2015-04-01).
- Fix: `normalizeDates` no longer rewrites `do` to `null` on deletion records, which had made 452 ended functions of Slovenské elektrárne look open-ended.
- Fix: a deleted company reports `subject.terminated`, `terminationDate` and `legalStatusEvents`; `nameCurrent` / `addressCurrent` are `null` when the register flags nothing as current, and the last registered values are in `nameLastRegistered` / `addressLastRegistered` (T-Mobile Slovensko, deleted 2010-07-01).
- Fix: `*_by_query` searches deleted subjects when no active subject matches; `NOT_FOUND` and `AMBIGUOUS` state `searched_including_terminated`.
- Added: registered capital (`equity`, `equityCurrent`), `legalFormName`; contributions use subscribed amounts with `paidValue` and `coOwned`; `stakeholdersOnly` keeps shareholders of a joint-stock company; `candidates_truncated` follows the upstream count.
- Source tests: 102 passed (9 files, including the documentation contract); TypeScript build passed. The new regression tests run on real `sluzby.orsr.sk` responses captured 2026-10-09 with persons anonymized; all failed on the previous code.

Tests and the live reads establish technical behavior for the four audited subjects. They do not establish the legal correctness of register data or of conclusions drawn from it.
