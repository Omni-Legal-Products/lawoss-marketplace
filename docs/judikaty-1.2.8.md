# Judikáty 1.2.8 acceptance

Source: `Omni-Legal-Products/mcp-judikaty-sk` commit `93ee32a1b3dd608ff5a8796ccf9b7f5dd658c7ed` (unchanged from 1.2.7). Runtime manifest SHA-256 `e1d13e109585876ce232b6dbd8f1215a1b19826007f85c0962f3a3c74d666467`.

- **Fix:** the third-party licence notices of the bundled runtime ship as `runtime/THIRD_PARTY_NOTICES.md` instead of `.txt`. The LAWOSS app installer accepts only `.json`, `.js`, `.mjs`, `.cjs`, `.md` and `LICENSE` in a Node plugin and refused the whole plugin because of the `.txt` file. The notice text is byte-identical.
- **Packaging:** rebuilt from the pinned commit with `scripts/package_runtime.py` (Node 24.22.1, esbuild 0.28.2 from the source build's lockfile). Every bundle file is byte-identical to 1.2.7; only the notices file name and its `provenance.json` entry changed. Source tests passed in the packager.
- **Catalog checks:** Python tests (including the new app installer contract), `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed.
- **Packaged runtime smoke (launcher CLI, fresh `LAWOSS_STATE_DIR` and `LAWOSS_CACHE_DIR`, 2026-11-16):** `doctor` reported the pinned commit and `tools` listed 24 tools.
- **Still refused by current app builds:** the installer also rejects any file over 1 MiB, and `runtime/dist/src/server/index.js` (2 450 371 B) is larger. This release removes the `.txt` refusal only; the size limit needs a separate packaging decision.
- **Codex gate:** not run for this candidate.

Tests establish technical behaviour, not the legal correctness of register data.
