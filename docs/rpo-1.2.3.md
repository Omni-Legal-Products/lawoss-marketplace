# RPO 1.2.3 acceptance

Source: `Omni-Legal-Products/mcp-rpo` commit `9098bc817613718291f90c9fb4ad2197a71a417c` (branch `fix/retry-429`, source package version 0.2.1). Runtime manifest SHA-256 `7a6f52357821f22f758fe81176bf7d335c96fa12d83d17fff77746605a867408`.

- **Fix (lawoss#421):** HTTP 429 from RPO is retried. `Retry-After` (seconds or HTTP date) is honoured up to 5 s per wait and 5 s in total per request; a longer `Retry-After` fails at once. Without it the client backs off exponentially. After the last attempt the tools return a Slovak message with `http_status` 429 instead of a generic failure. 5xx and network retries are unchanged.
- **Source checks (packager):** `npm ci`, `npm run build` and `npm test` with 150 passed tests, among them 13 in `tests/rate-limit.test.ts`.
- **Catalog checks:** Python tests, `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed. The bundle's reviewed digest in `scripts/validate.py` was renewed after its URL and hostname scan hits were compared with the previous bundle and found identical.
- **Packaged runtime smoke (launcher CLI, isolated `LAWOSS_STATE_DIR` and `LAWOSS_CACHE_DIR`, 2026-11-15):** `doctor` reported commit 9098bc81; `tools` listed 3 tools; `rpo_search` and `rpo_get_entity` for IČO 31322832, each twice in a row, returned SLOVNAFT, a.s.; a name search returned 54 matches. No HTTP 429 reached the caller. The client retries silently, so a retried 429 cannot be ruled out from these calls; the retry path is covered by the source tests.
- **Codex gate:** not run for this candidate.

Tests establish technical behaviour, not the legal correctness of register data.
