# ORSR 1.2.2 acceptance

Source: `Omni-Legal-Products/mcp-orsr` commit `d31637dd2ad4a5e8b14ef1ab202663f08acddedb` (unchanged from 1.2.1). Runtime manifest SHA-256 `04a9f7c4e26a27df5d891d3c2e10bc513fc6cac68009fcb0d595f4bfa7fba13d`.

- **Fix:** the third-party licence notices of the bundled runtime ship as `runtime/THIRD_PARTY_NOTICES.md` instead of `.txt`. The LAWOSS app installer accepts only `.json`, `.js`, `.mjs`, `.cjs`, `.md` and `LICENSE` in a Node plugin and refused the whole plugin because of the `.txt` file. The notice text is byte-identical.
- **Packaging:** rebuilt from the pinned commit with `scripts/package_runtime.py` (Node 24.22.1, esbuild 0.27.2 via `ESBUILD_BINARY`, the version that built the previous bundle). Every bundle file is byte-identical to 1.2.1; only the notices file name and its `provenance.json` entry changed. Source tests passed in the packager.
- **Catalog checks:** Python tests (including the new app installer contract), `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed.
- **Still refused by current app builds:** the installer also rejects any file over 1 MiB, and `runtime/dist/server.js` (1 167 194 B) is larger. This release removes the `.txt` refusal only; the size limit needs a separate packaging decision.
- **Codex gate:** not run for this candidate.

Tests establish technical behaviour, not the legal correctness of register data.
