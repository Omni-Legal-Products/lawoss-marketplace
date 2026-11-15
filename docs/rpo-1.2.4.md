# RPO 1.2.4 acceptance

Source: `Omni-Legal-Products/mcp-rpo` commit `9098bc817613718291f90c9fb4ad2197a71a417c` (unchanged from 1.2.3). Runtime manifest SHA-256 `4d13d62364ea12359d0787bae6fa6be1123e382dd389cb4a1c43cada1b4ed3d6`.

- **Fix:** the third-party licence notices of the bundled runtime ship as `runtime/THIRD_PARTY_NOTICES.md` instead of `.txt`. The LAWOSS app installer accepts only `.json`, `.js`, `.mjs`, `.cjs`, `.md` and `LICENSE` in a Node plugin and refused the whole plugin because of the `.txt` file. The notice text is byte-identical.
- **Packaging:** rebuilt from the pinned commit with `scripts/package_runtime.py` (Node 24.22.1, esbuild 0.28.2 from the source build's lockfile). Every bundle file is byte-identical to 1.2.3; only the notices file name and its `provenance.json` entry changed. Source tests passed in the packager.
- **Catalog checks:** Python tests (including the new app installer contract), `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed.
- **Packaged runtime smoke (launcher CLI, fresh `LAWOSS_STATE_DIR` and `LAWOSS_CACHE_DIR`, 2026-11-16):** `doctor` reported the pinned commit and `tools` listed 3 tools.
- **Still refused by current app builds:** the installer also rejects any file over 1 MiB, and `runtime/dist/server.js` (1 179 590 B) is larger. This release removes the `.txt` refusal only; the size limit needs a separate packaging decision.
- **Codex gate:** not run for this candidate.

Tests establish technical behaviour, not the legal correctness of register data.
