# LAWOSS Marketplace

LAWOSS Marketplace distributes public-safe plugin wrappers for approved LAWOSS
MCP projects. All 15 catalog entries include a local MCP runtime, usage skills and CLI. The Czech bundle contains eight separately selectable services. Source coverage and provider prerequisites are documented per plugin; installation does not make unavailable datasets complete.

Read the [local runtime acceptance record](docs/local-runtime.md) for the CRZ
pilot and the remaining rollout.

Maintainers can [prepare any plugin release](docs/RELEASES.md); users can
[update their installed plugins with one command](docs/updating.md).

## Install the local catalog

```bash
codex plugin marketplace add /path/to/lawoss-marketplace
codex plugin add crz@lawoss --json
codex plugin list
```

Each plugin registers its bundled local stdio MCP and includes CLI access. See the [CRZ installation example](plugins/crz/README.md) and [full rollout and coverage](docs/full-rollout.md). No source-repository access is required for the packaged runtime. Node.js and npm remain prerequisites.

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
listed MCP servers. The marketplace is public. Maintainer source repositories remain private, while reviewed runtime artifacts are included here. No public hosting service is included.

## Catalog

CRZ · CZ Agents · DISQ · EUR-Lex · Finančná správa · Judikáty · Kalkulačky ·
ORSR · Obchodný vestník · RPO · RPVS · Register úpadcov · RÚZ · Slov-Lex · ÚVO.

Each wrapper records its exact organization source commit in its README and in
`releases.json`. After updating this catalog, update/reinstall the selected plugin
using your harness, then separately review and deploy a new server revision if
needed. Credentials, OAuth grants and operator data never come from the catalog.
