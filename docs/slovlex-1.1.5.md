# Slov-Lex 1.1.5 acceptance

Source: `Omni-Legal-Products/mcp-slovlex` commit `bcc73f5dcc6d323600ecba72ddc61d18a77046eb` (unchanged from 1.1.4). Runtime manifest SHA-256 `18e103aa617ebdccdb8f9634ce8dfe1bdb3aded6d784804cf18696dc9e98407c`.

- **Fix:** the third-party licence notices of the bundled runtime ship as `runtime/THIRD_PARTY_NOTICES.md` instead of `.txt`. The LAWOSS app installer accepts only `.json`, `.js`, `.mjs`, `.cjs`, `.md` and `LICENSE` in a Node plugin and refused the whole plugin because of the `.txt` file. The notice text is byte-identical.
- **Packaging:** rebuilt from the pinned commit with `scripts/package_runtime.py` (Node 24.22.1, esbuild 0.27.2 from the source build's lockfile). Every bundle file is byte-identical to 1.1.4; only the notices file name and its `provenance.json` entry changed. Source tests passed in the packager.
- **Catalog checks:** Python tests (including the new app installer contract), `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed.
- **Still refused by current app builds:** the installer also rejects any file over 1 MiB, and `runtime/dist/index.js` (6 250 634 B) and `runtime/dist/pdf.worker.mjs` (2 076 112 B); the plugin also exceeds 8 MiB in total is larger. This release removes the `.txt` refusal only; the size limit needs a separate packaging decision.
- **Codex gate:** not run for this candidate.

Tests establish technical behaviour, not the legal correctness of register data.
