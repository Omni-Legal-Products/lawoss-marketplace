# LAWOSS Marketplace

LAWOSS Marketplace distributes public-safe plugin wrappers for approved LAWOSS
MCP projects. The initial catalog contains only `crz@lawoss`.

## Install the local catalog

```bash
codex plugin marketplace add /path/to/lawoss-marketplace
codex plugin add crz@lawoss --json
codex plugin list
```

The CRZ wrapper installs guidance for choosing and safely using CRZ tools. It
does not install or configure an MCP server. Follow the wrapper's linked setup
documentation to run your own local or authenticated self-hosted instance.

## Distribution boundary

- `.agents/plugins/marketplace.json` is the canonical Codex catalog.
- `.claude-plugin/marketplace.json` carries the aligned compatibility catalog.
- Installable wrappers live under `plugins/<name>` and resolve inside this repo.
- A wrapper becomes available only after its organization source passes the
  public release gate.
- Wrappers contain no credentials, user-specific paths, private infrastructure,
  or automatic connection to a personal MCP service.

The catalog is a source distribution. It does not host, deploy, or operate the
listed MCP servers.
