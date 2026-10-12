# Judikáty 1.2.5 acceptance

Source: `Omni-Legal-Products/mcp-judikaty-sk` commit `20d3c7ff54ddd70c6a7538831fdd39fa3bfbc38e` (PR #6 into `codex/lawoss-release-2026-09-05`). Runtime manifest SHA-256 `b112a27e44385a4bbdfdde2c7128fb5bdfc4a38aa02ea15da4c0e744491ab664`.

- **Added in the source:** the maintenance scripts `maintain:reextract-relations` and `diagnose:reextract-relations`. They let an operator of a self-hosted index, e.g. one imported from a snapshot built before 1.2.4, re-extract stored relation outcomes with the current extractor. The scripts are dry-run by default, write in logged batches and are reversible, and they make no requests to court sources. They are part of the source repository, not of the packaged plugin runtime. In the runtime only the store module changes: it gains the repair-log columns and the write path the script uses, and the server never calls them.
- **Source checks:** `npm ci`, `npm run check`, `npm run build`, and `npm test` with 924 tests (911 passed, 0 failed, 13 live tests skipped).
- **Catalog checks:** 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed.
- **Packaged runtime smoke (stdio, 2026-10-12):** the server info reported version 0.2.5, and `get_treatment_index_stats` answered.
