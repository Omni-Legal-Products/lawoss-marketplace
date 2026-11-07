# Release v0.2.1: shared launcher for every runtime plugin

- **Date:** 2026-11-07
- **Scope:** `scripts/run.mjs` only. Runtimes, provenance, skills and source commits are unchanged from v0.2.0.
- **Why:** LAWOSS RAM budget of 2 GB (Omni-Legal-Products/lawoss#367, ADR 0017 in lawOSS-like-SK-CZ).

## Launcher changes since v0.2.0
- #41: npm runs through the same Node on Windows; the npm LAWOSS bundles is found in `lib/npm`.
- #42: MCP servers run in the launcher process (one Node.js process per server instead of two). One dependency installation at a time across all plugins; the same runtime version is installed once.
- This release: the entrypoint path is resolved before use (in-process and the cz-agents policy proxy), so servers that check `process.argv[1]` against `import.meta.url` also start when the cache path goes through a symlink (for example `/var` → `/private/var` on macOS). Before this, `cz-agents` servers closed the connection in such caches.

## Versions
| Plugin | v0.2.0 | v0.2.1 |
|---|---|---|
| crz | 1.5.0 | 1.5.1 |
| cz-agents | 1.1.2 | 1.1.3 |
| disq | 1.2.0 | 1.2.1 |
| eurlex-celex | 1.2.1 | 1.2.2 |
| fs-opendata-mcp | 1.2.0 | 1.2.1 |
| judikaty | 1.2.5 | 1.2.6 |
| kalkulacky | 1.2.0 | 1.2.1 |
| orsr | 1.2.0 | 1.2.1 |
| ov | 1.2.2 | 1.2.3 |
| rpo | 1.2.1 | 1.2.2 |
| rpvs | 1.2.0 | 1.2.1 |
| ru | 1.2.0 | 1.2.1 |
| ruz | 1.3.0 | 1.3.1 |
| slovlex | 1.1.3 | 1.1.4 |
| uvo | 1.2.0 | 1.2.1 |

## Verification
- `python3 -m unittest discover -s tests`: 50 tests, OK (1 skipped). The four `NpmResolutionTest` cases need an official, statically linked Node build; with Homebrew Node they fail on `libnode.dylib` also on `main`.
- `python3 scripts/validate.py`, `claude plugin validate --strict .`, `node --test tests/test_runtime_policy.mjs`: passed.
- Real servers over stdio (`initialize` + `tools/list`): kalkulacky 5 tools, orsr 13, slovlex 10, judikaty 24, ruz 8, rpo 3, each with 0 child processes; cz-agents `--server ares` 9 tools through the policy proxy.
- Codex gate (CLI 0.164.0 has no plugin validator): isolated `CODEX_HOME`, `orsr@lawoss` installed from `main` (1.2.0), updated to `release/v0.2.1` (1.2.1), runtime started over stdio and listed 13 tools, rolled back to 1.2.0 with `scripts/update_plugins.py`.
- LAWOSS desktop with the RAM gate (`lawoss/scripts/memory-budget/run.mjs`): see the snapshot PR in lawoss.
