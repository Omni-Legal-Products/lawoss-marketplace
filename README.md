# LAWOSS Marketplace

LAWOSS Marketplace distributes public-safe plugin wrappers for approved LAWOSS
MCP projects. The catalog contains 15 reviewed organization editions. CRZ includes a local
MCP runtime, skill and CLI. The other 14 remain guidance-only pending their
individual portable-runtime verification.

Read the [local runtime acceptance record](docs/local-runtime.md) for the CRZ
pilot and the remaining rollout.

Maintainers can [prepare a versioned CRZ release](docs/releasing.md); users can
[update their installed plugins with one command](docs/updating.md).

## Install the local catalog

```bash
codex plugin marketplace add /path/to/lawoss-marketplace
codex plugin add crz@lawoss --json
codex plugin list
```

The CRZ plugin installs and registers a local stdio MCP with a bundled CLI.
The other wrappers currently install guidance only. For example, follow the local
[CRZ wrapper and setup guidance](plugins/crz/README.md) for the separate source
prerequisite and the local installation procedure.

## Distribution boundary

- `.agents/plugins/marketplace.json` is the canonical Codex catalog.
- `.claude-plugin/marketplace.json` carries the semantically aligned Claude
  catalog in Claude's intentionally different schema.
- Installable wrappers live under `plugins/<name>` and resolve inside this repo.
- A wrapper becomes available only after its organization source passes the
  public release gate.
- Wrappers contain no credentials, user-specific paths, private infrastructure,
  or automatic connection to a personal MCP service.

The catalog is a source distribution. It does not host, deploy, or operate the
listed MCP servers. Repositories remain private: GitHub membership is required
to clone the catalog and server source. No public hosting service is included.

## Catalog

CRZ · CZ Agents · DISQ · EUR-Lex · Finančná správa · Judikáty · Kalkulačky ·
ORSR · Obchodný vestník · RPO · RPVS · Register úpadcov · RÚZ · Slov-Lex · ÚVO.

Each wrapper records its exact organization source commit in its README and in
`releases.json`. After updating this catalog, update/reinstall the selected plugin
using your harness, then separately review and deploy a new server revision if
needed. Credentials, OAuth grants and operator data never come from the catalog.
