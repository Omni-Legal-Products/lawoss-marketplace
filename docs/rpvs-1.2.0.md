# RPVS 1.2.0 acceptance

Source: `Omni-Legal-Products/mcp-rpvs` commit `a6e0667c09022ad5c716f5a9517d512d6936e377` (PR #1 into `codex/lawoss-release-2026-09-05`), runtime 0.3.0.

- Fix: partners with more than 20 KUV records no longer lose their current KUV. The detail is read as a single entity `Partneri(Id)`; the collection query nested at most 20 rows, oldest first, and its nested continuation link answers 404. A collection the source still pages is read through its own entity set, otherwise it is listed in `incompleteCollections`.
- Fix (regression of 0.2.0): a decided qualified proposal (`SposobRozhodnutiaKP`, Edm.Int32) was dropped by the shape check and `sanctionProceedings` came back empty. It is now kept with `decisionCode`; a row that fails a shape check is reported in `incompleteCollections` and `notes` instead of disappearing.
- Fix: `partnerId` means `Partneri.Id` everywhere. `rpvs_get_partner` accepts `insertNumber` (the insert number shown on rpvs.gov.sk); `rpvs_search` returns `partnerId` and `insertNumber`. Value change: the bulk `partnerId` is now `Partneri.Id`; the previous value is in `pvsRecordId`.
- Fix: one IČO with several registrations resolves to the active one; all are listed in `registrations`.
- Fix: `rpvs_bulk_lookup` reports the current record with `aktivny`, `vymaz`, `cislo_vlozky` and `pocet_registracii`, and an error item carries its `ico`.
- Added: `deletion`, `fine` and `uboIdentityVerification.verifiedOn`; name search ignores letter case and also matches a natural person's surname; addresses keep both house numbers.
- Source tests: 167 passed (including organization contract tests); TypeScript typecheck and build passed. Eighteen regression tests run against RPVS responses captured on 2026-10-09 with natural persons anonymized.
- Catalog: 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed. The Codex plugin-creator validator was not available in the preparing environment and still has to run.
- Packaged runtime smoke (stdio, live RPVS read, 2026-10-12): 3 tools; IČO 35763469 returned 3 current KUV of 31 and the KUV identification date 2026-06-30; partner 18507 returned its qualified proposal with `decisionCode` 1 and the deletion of 2018-12-20.

Pending before merge: Codex plugin-creator validator and isolated Git-marketplace install/update/rollback acceptance.

Tests establish behavior for the captured responses and selected live reads. They do not establish who the beneficial owner legally is or what the undecoded decision code means.
