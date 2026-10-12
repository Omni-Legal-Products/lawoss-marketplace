# Judikáty 1.2.4 acceptance

Source: `Omni-Legal-Products/mcp-judikaty-sk` commit `69b0b94c6220237b5aa735a3d946f45917caf3f7` (PR #5 into `codex/lawoss-release-2026-09-05`). Runtime manifest SHA-256 `4ff0abea5a12c486f2b2e0b59d0fd369687581a2da2fb96a9534dafc02597943`.

- **Fix:** the relation extractor reads operative-part shapes the 1.2.0 version missed:
  - Constitutional Court preambles;
  - several challenged decisions in one preamble;
  - verb-first operative parts, and lists of references before one verb;
  - "zastavuje", "nevyhovuje", "porušené bolo/neboli" and "zmeňuje".
- **Offline measurement against confident model labels on the source's index snapshot:** agreement is NS 94.6 %, Constitutional Court 77.0 % and other courts 81.7 %. False "quashed/changed" stay near zero. The usage skill states these figures.
- **Source checks:** `npm ci`, `npm run check`, `npm run build`, and `npm test` with 911 tests (898 passed, 0 failed, 13 live tests skipped).
- **Catalog checks:** 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed.
- **Packaged runtime smoke (stdio, 2026-10-12):** the server info reported version 0.2.4, and auto-mode `resolve_decision_identity` "PL. ÚS 3/09" resolved at the Constitutional Court.
- **Codex gate:** Codex CLI 0.162.1 has no plugin-creator validator, so the isolated install acceptance from `docs/RELEASES.md` ran (2026-10-12):
  - installing from `main` gave 1.2.3;
  - with the ref set to `release/judikaty-1.2.4`, the updater reported `updated 1.2.3 -> 1.2.4` and the installed runtime advertised version 0.2.4;
  - with the ref set back to `main`, the updater reported `updated 1.2.4 -> 1.2.3` and `doctor` reported commit 06b9e1e.

Tests and the offline measurement establish technical behaviour and agreement with model labels, not legal correctness.
