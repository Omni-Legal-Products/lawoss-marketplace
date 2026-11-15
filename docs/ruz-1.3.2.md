# RÚZ 1.3.2 acceptance

Source: `Omni-Legal-Products/mcp-ruz` commit `629e917b0db60fdc83f478cc40f42b1d591485bf` (unchanged from 1.3.1). Runtime manifest SHA-256 `9350e4e19c6deb47058c24e595323001d4b70ec248aefa2f649ebd6aa8898d46`.

- **Fix:** the third-party licence notices of the bundled runtime ship as `runtime/THIRD_PARTY_NOTICES.md` instead of `.txt`. The LAWOSS app installer accepts only `.json`, `.js`, `.mjs`, `.cjs`, `.md` and `LICENSE` in a Node plugin and refused the whole plugin because of the `.txt` file. The notice text is byte-identical.
- **Packaging:** rebuilt from the pinned commit with `scripts/package_runtime.py` (Node 24.22.1, esbuild 0.27.2 via `ESBUILD_BINARY`, the version that built the previous bundle). Every bundle file is byte-identical to 1.3.1; only the notices file name and its `provenance.json` entry changed. Source tests passed in the packager.
- **Catalog checks:** Python tests (including the new app installer contract), `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed.
- **Still refused by current app builds:** the installer also rejects any file over 1 MiB, and `runtime/dist/server.js` (1 353 854 B) is larger. This release removes the `.txt` refusal only; the size limit needs a separate packaging decision.
- **Codex gate:** not run for this candidate.

Tests establish technical behaviour, not the legal correctness of register data.
