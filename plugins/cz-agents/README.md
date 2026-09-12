# České registre – ARES, ČNB a ďalšie · LAWOSS

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

ARES and ČNB work without keys; ADIS always uses live SOAP. ISIR exposes a verified event feed, while unverified corporate/person screening returns an explicit error. Sanctions require a populated SANCTIONS_DB with successful refresh records no older than seven days; responses identify loaded sources. DD risk conclusions and real-estate aggregates remain unavailable until their data coverage is independently verified. EU Registry requires CH_API_KEY for GB; Poland supports exact KRS identifiers, and DE/NL use GLEIF coverage. Missing coverage never means a clean negative finding.

The public plugin uses local stdio and requires no LAWOSS login. Provider credentials, when required, are supplied by the user outside Git. Doctor reports the cache and persistent state locations without installing dependencies. Updates reuse persistent state and create a separate code/dependency cache when runtime contents change.

## Updates

Refresh the marketplace with `codex plugin marketplace upgrade lawoss`, then reinstall `cz-agents@lawoss`. The [central updater](../../docs/updating.md) can update selected installed LAWOSS plugins together. Start a new task after updating. Local plugin updates do not deploy hosted servers.

## Provenance

Built from [reviewed organization source](https://github.com/Omni-Legal-Products/mcp-cz-agents/tree/294e9f9e8b704bbc7438ca2966b88ca6ac1ea84b), revision `294e9f9e8b704bbc7438ca2966b88ca6ac1ea84b`. Runtime file hashes and the configuration hash are recorded in runtime/provenance.json. [License and attribution](LICENSE) are preserved. Build checks do not establish source freshness or legal correctness.

For a query-only mount of an existing sanctions database, set `SANCTIONS_READ_ONLY=1` alongside `SANCTIONS_DB`. This skips database creation, migration and WAL setup. The refresh job needs its own writable connection.
