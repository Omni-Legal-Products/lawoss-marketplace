# CRZ 1.4.3 acceptance

Source: `Omni-Legal-Products/mcp-crz` commit `f4cc8bf0c4560f3ee50205dd9f7452b415197ffa` (unchanged from 1.4.2).

Problem: CRZ was the only runtime plugin without `runtime-config.json` and with its own older launcher. A client that recognizes a LAWOSS bundled runtime by `runtime-config.json` plus `scripts/run.mjs` kept the relative launcher path, so the MCP closed its connection on start when the client's working directory was not the plugin root.

Change: the runtime is packaged by `scripts/package_runtime.py` like every other runtime plugin. The plugin now ships `runtime-config.json`, the shared launcher and a provenance with the configuration hash. The unreachable `dist/crz/bulk.js` and the empty type module `dist/crz/types.js` are no longer shipped. The CRZ-only release scripts and workflow were removed; `scripts/release_plugin.py --plugin crz` uses the generic path.

- Source tests: 86 passed; TypeScript build passed.
- `release_plugin.py --plugin crz` from the committed catalog rebuilt a byte-identical runtime, `runtime-config.json` and provenance.
- Catalog: Python tests, runtime policy tests, public-content validator, Claude marketplace validator (`--strict`) and instruction mirrors passed.
- Isolated Codex Git-marketplace install, update and rollback: all three stages exposed 10 tools, completed a live `crz_recent` read and started warm without npm. Rollback reused the original cache.
- Stdio from an unrelated working directory with an absolute launcher path: `initialize` and `tools/list` returned 10 tools.

Not verified here: the Codex `plugin-creator` validator (not installed in the release environment), Claude runtime, Windows and Linux.
