# Judikáty 1.2.1 acceptance

Source: `Omni-Legal-Products/mcp-judikaty-sk` commit `5889b7296859a347242a9cf89cf996e2058557c1` (PR #2 into `codex/lawoss-release-2026-09-05`). Runtime manifest SHA-256 `008c7b4d8ce89a30a90fd653e7f92b31dbd9668703c0d131368adf692995a7de`.

Remaining medium findings of the audit of 2026-10-09:

- **Local data directory:** `JUDIKATY_DATA_DIR` sets it; under LAWOSS the default is the plugin's state directory. The index stats report the index path and explain an empty index.
- **Constitutional Court metadata:**
  - `merit` carries the file-level result only for documents that close the file.
  - Complained-of provisions are labelled as such, and a `citedLaw` search says what it matches.
  - Plenary and two-digit-year references ("PL. ÚS 3/09") are kept in search results.
- **NS decision form:** read from the document heading, never from words in the reasoning.

Verification:

- **Source:** `npm ci`, `npm run check`, `npm run build`, and `npm test` with 892 tests (879 passed, 0 failed, 13 live tests skipped). The builder reran the source tests.
- **Catalog:** 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed.
- **Packaged runtime smoke (stdio, live reads, 2026-10-12):**
  - `doctor` reported commit 5889b72.
  - ÚS search "PL. ÚS 3/09" returned the reference.
  - NS 9So/6/2013 has form Rozsudok.
  - `get_nsud_index_stats` reported the index under the plugin state directory.

Tests establish behaviour for captured source responses and selected live reads. They do not establish legal correctness.
