# Judikáty 1.2.0 acceptance

Source: `Omni-Legal-Products/mcp-judikaty-sk` commit `211a958d19e4eabed232b833514b351f489769f2` (PR #1 into `codex/lawoss-release-2026-09-05`). Runtime manifest SHA-256 `2ae5db36658163630d313fa1eb8688222dc7a01c8ae5b153ebfb4b8bbdbb8e25`.

Fixes from the external audit of 2026-10-09:

- **Appellate identity:** detail, identity, Slov-Lex context and markdown headers of appellate justice decisions report the decision's own file number and deciding court. Before, they showed the first-instance file (15Co/134/2024 had appeared as "Mestský súd Bratislava IV, B3-11C/182/1987").
- **Review outcomes:** an outcome is claimed only from a present-tense operative verb in the source decision's operative part. Cited decisions, past tense, negations and foreign courts no longer yield outcomes. Text-derived outcomes are labelled as estimates (`textEstimate`).
- **Shared file numbers:** a number held by several courts is not resolved to one of them. The result is `matched: false` with the candidates, and treatment and case chain add `ambiguityNote`.
- **Self-review:** a decision no longer reviews itself. The direction of appellate relations is carried over from the source's personal line.
- **Cited regulations:** the parser no longer invents provisions (letter, OSP, paragraph suffix).
- **PDF text:** normalisation no longer rewrites EU-act citations.
- **Constitutional Court:** ÚS references resolve in auto mode.
- **Compact view:** compact results keep `coverageNotes`.
- **NS law search:** a note states that `total` counts a capped sample.
- **Startup:** the server needs no OAuth variables over stdio and requires Node 22.13 or newer. The plugin launcher still declares 22.14.

The organization edition also gains, from the source's personal line since 2026-09-20:

- abstracts;
- deterministic decision form;
- the model-label layer, with its nightly job off by default;
- the index snapshot import;
- dependency updates.

Verification:

- **Source:** `npm ci`, `npm run check`, `npm run build`, and `npm test` with 862 tests (849 passed, 0 failed, 13 live tests skipped), including the organization contract tests. Builder rerun: 849 passed.
- **Catalog:** 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed.
- **Not run:** the Codex plugin-creator validator was not available in the preparing environment and still has to run.
- **Packaged runtime smoke (stdio, live reads, 2026-10-12):**
  - `doctor` reported commit 211a958.
  - `resolve_decision_identity` "5Co/1/2020" returned `matched: false` with three regional courts.
  - `get_decision_detail` for 15Co/134/2024 reported Krajský súd Bratislava and 15Co/134/2024.
  - Auto mode "PL. ÚS 3/09" resolved at the Constitutional Court.

Pending before merge: Codex plugin-creator validator and isolated Git-marketplace install/update/rollback acceptance.

Tests establish behaviour for captured source responses, a real judgment text and selected live reads. They do not establish the legal correctness of any outcome or citation.
