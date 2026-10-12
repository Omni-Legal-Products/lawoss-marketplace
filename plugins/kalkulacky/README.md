# Právne kalkulačky SR · LAWOSS

Installs the local MCP runtime, usage guidance and CLI. Requires Node.js 22.14+ with npm; the Czech edition is verified on Node 22. On first use, locked dependencies are installed into a versioned cache. Later starts reuse that cache. The Czech edition also builds the allowlisted SQLite native dependency for the current platform; a C/C++ toolchain may be needed when a prebuilt binding is unavailable.

## CLI

From the installed plugin directory:

```bash
node scripts/run.mjs doctor
node scripts/run.mjs tools
node scripts/run.mjs call TOOL_NAME '{}'
```

For Czech services, insert `--server ares` (or cnb, adis, isir, sanctions, dd, realestate, eu-registry) before the command. Each service is registered separately and can be enabled when needed. The CLI is bundled; no global executable is installed.

## Coverage and setup

Uses bundled rate tables. Check the reported coverage dates before calculating; installation does not establish that each rate table covers the requested date.

The public plugin uses local stdio and requires no LAWOSS login. Provider credentials, when required, are supplied by the user outside Git. Doctor reports the cache and persistent state locations without installing dependencies. Updates reuse persistent state and create a separate code/dependency cache when runtime contents change.

## Updates

Refresh the marketplace with `codex plugin marketplace upgrade lawoss`, then reinstall `kalkulacky@lawoss`. The [central updater](../../docs/updating.md) can update selected installed LAWOSS plugins together. Start a new task after updating. Local plugin updates do not deploy hosted servers.

## Provenance

Built from [reviewed organization source](https://github.com/Omni-Legal-Products/mcp-kalkulacky-sk/tree/ab057d70eb788ea2e4e0e6dadbe8e553a0ef579e), revision `ab057d70eb788ea2e4e0e6dadbe8e553a0ef579e`. Runtime file hashes and the configuration hash are recorded in runtime/provenance.json. [License and attribution](LICENSE) are preserved. Build checks do not establish source freshness or legal correctness.
