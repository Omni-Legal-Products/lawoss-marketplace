# CRZ · LAWOSS local plugin

Installs a local MCP runtime, a usage skill and command-line access to the same ten tools. It does not connect to a hosted MCP.

## Installation

Install Node.js 22.13 or newer with npm, add this marketplace and install `crz@lawoss`. On first use, the launcher installs integrity-locked dependencies in the user's cache. Internet access to the npm registry is required once per runtime version; later starts reuse that cache. MCP communication uses stdio and opens no HTTP listener.

Codex resolves the configured `cwd` relative to the installed plugin root. The local runtime has been tested in Codex on macOS; Claude catalog validation alone does not prove Claude runtime compatibility.

## CLI

From the installed plugin directory:

```bash
node scripts/run.mjs --help
node scripts/run.mjs doctor
node scripts/run.mjs tools
node scripts/run.mjs call crz_recent '{"limit":1}'
```

The CLI is bundled with the plugin; it does not create a global shell command. `doctor` checks the runtime and cache without installing dependencies. `tools` and `call` print JSON; diagnostics go to stderr. A failed tool returns a nonzero exit status.

## Updates

For a Git-backed catalog, refresh `codex plugin marketplace upgrade lawoss`, then reinstall `codex plugin add crz@lawoss`. Start a new task for updated skills and MCP tools. With a local catalog, update its checkout first, then reinstall.

A different runtime content hash gets a separate dependency cache. Reinstalling the previous plugin version reuses its old cache. Plugin updates do not touch another plugin or server deployment.

Node/npm are prerequisites and are not updated by this plugin. `LAWOSS_CACHE_DIR` optionally sets a different cache root. Cached dependency installation is not a sandbox; tools run with the local process permissions.

## Data handling

Data comes from the public CRZ website. OCR may use Mistral only when explicitly enabled with the user's own key; no key is shipped. Files requested by CLI/MCP are saved locally. See the [usage skill](skills/crz-register-zmluv/SKILL.md) for source limits.

## Provenance

Built from [reviewed organization source](https://github.com/Omni-Legal-Products/mcp-crz/tree/f4cc8bf0c4560f3ee50205dd9f7452b415197ffa), revision `f4cc8bf0c4560f3ee50205dd9f7452b415197ffa`. Build output and lockfile hashes are recorded in runtime/provenance.json. [License and attribution](LICENSE) are preserved.
