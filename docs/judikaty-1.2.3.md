# Judikáty 1.2.3 acceptance

Source: `Omni-Legal-Products/mcp-judikaty-sk` commit `06b9e1e8604f50d876605a3d5d172c2522f182f5` (PR #4 into `codex/lawoss-release-2026-09-05`). Runtime manifest SHA-256 `ba2bc9e172c2e4377d7f5a10a3b4e7a7d64e1f7c49950a0051c508d2b444413f`.

- **Fix:** the server advertises the version of the package it ships in, in the MCP server info and on `/healthz`. `MCP_SERVER_VERSION` is no longer read; a pinned value had made a deployment report a stale version for every release. The version is looked up in the nearest `package.json` of this server, which in the plugin is `runtime/package.json`.
- **Source checks:** `npm ci`, `npm run check`, `npm run build`, and `npm test` with 898 tests (885 passed, 0 failed, 13 live tests skipped).
- **Catalog checks:** 42 Python tests, `scripts/validate.py`, `claude plugin validate --strict .` and instruction mirrors passed.
- **Packaged runtime smoke (stdio, 2026-10-12):** with `MCP_SERVER_VERSION=0.1.0` set, the MCP handshake reported server info `{"name":"slovak-judiciary","version":"0.2.3"}`.
- **Codex gate:** Codex CLI 0.162.1 has no plugin-creator validator, so the isolated install acceptance from `docs/RELEASES.md` ran (2026-10-12):
  - installing from `main` gave 1.2.2;
  - with the ref set to `release/judikaty-1.2.3`, the updater reported `updated 1.2.2 -> 1.2.3` and the installed runtime advertised version 0.2.3;
  - with the ref set back to `main`, the updater reported `updated 1.2.3 -> 1.2.2` and `doctor` reported commit 72ddb64.

Tests establish technical behaviour, not legal correctness.
