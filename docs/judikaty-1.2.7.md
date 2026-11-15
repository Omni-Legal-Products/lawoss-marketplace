# Judikáty 1.2.7 acceptance

Source: `Omni-Legal-Products/mcp-judikaty-sk` commit `93ee32a1b3dd608ff5a8796ccf9b7f5dd658c7ed` (branch `fix/prazdny-index-zaloha`, source package version 0.2.5). Runtime manifest SHA-256 `1c06c113350bfe30024f7ddf9265c5197fd33b76920b9ec4945dc751a2c84c1d`.

- **Fix (lawoss#420):** a desktop installation has no local index. `search_decision_text` now falls back to the live `search_decisions` path and labels the result (`mode: "live_fallback"`, `fullTextSearch: false`, `localIndex.status: "not_available_on_this_installation"`). `get_decision_treatment`, `get_case_chain`, the watchlist fate and both stats tools report `not_available_on_this_installation` instead of an empty, negative-looking result.
- **Skill:** the catalog skill takes the source skill change from 20d3c7f to 93ee32a. `search_decisions` is the normal live search, `search_decision_text` is local full text with a labelled fallback, and a missing index is not a negative finding.
- **Source checks (packager):** `npm ci`, `npm run build` and `npm test` with 934 tests (921 passed, 0 failed, 13 live tests skipped).
- **Catalog checks:** Python tests, `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed. The bundle's reviewed digest in `scripts/validate.py` was renewed after its URL and hostname scan hits were compared with the previous bundle and found identical.
- **Packaged runtime smoke (launcher CLI, isolated `LAWOSS_STATE_DIR` and `LAWOSS_CACHE_DIR`, 2026-11-15):** `doctor` reported commit 93ee32a1; `tools` listed 24 tools; `search_decision_text` for "zodpovednosť za škodu" returned 7 labelled `live_fallback` hits; `search_decisions` for the same query returned 7 hits from justice and nsud.
- **Codex gate:** not run for this candidate.

Tests establish technical behaviour, not legal correctness.
