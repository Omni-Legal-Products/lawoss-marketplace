# Kalkulačky 1.2.2 acceptance

Source: `Omni-Legal-Products/mcp-kalkulacky-sk` commit `5ff45d0d03887bd3a166f80f40635a508a2d1a3f` (unchanged from 1.2.1). Runtime manifest SHA-256 `64dfa1ed96430f0f0ffd643221d3491770655a68b91096f40c9255489fea94bb`.

- **Fix:** the third-party licence notices of the bundled runtime ship as `runtime/THIRD_PARTY_NOTICES.md` instead of `.txt`. The LAWOSS app installer accepts only `.json`, `.js`, `.mjs`, `.cjs`, `.md` and `LICENSE` in a Node plugin and refused the whole plugin because of the `.txt` file. The notice text is byte-identical.
- **Packaging:** rebuilt from the pinned commit with `scripts/package_runtime.py` (Node 24.22.1, esbuild 0.27.2 via `ESBUILD_BINARY`, the version that built the previous bundle). Every bundle file is byte-identical to 1.2.1; only the notices file name and its `provenance.json` entry changed. Source tests passed in the packager.
- **Catalog checks:** Python tests (including the new app installer contract), `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed.
- **App installer:** no file exceeds the installer's 1 MiB per-file or 8 MiB per-plugin limits.
- **Codex gate:** not run for this candidate.

Tests establish technical behaviour, not the legal correctness of register data.
