# Self-hosted LAWOSS server · LAWOSS

Skill-only plugin that walks an AI agent, together with the person who owns
the server, through deploying
[lawoss-selfhost](https://github.com/Omni-Legal-Products/lawoss-selfhost/tree/29440f8af25792e42b4c764f8334ec9be239439b)
on infrastructure that person controls. LAWOSS hosts nothing: the operator is
responsible for the server, its users and respecting the terms of the public
sources.

The skill (Slovak) has 15 steps. Each one states what the agent may do alone
and what the human must confirm or do: server choice, SSH access, package
installation, firewall, DNS, the certificate authority's terms and contact
e-mail, the brand and the right to use the logo, account activation, the
backup key and its schedule. Secrets are generated on the server and never
enter the conversation; the skill lists the commands an agent must never run
and says to stop and rotate when a secret appears in any output. A passing
`doctor` proves that the deployment works technically, not that the data
sources are complete.

When a reverse proxy (Traefik on Dokploy, Coolify or a hand-made one) already
owns ports 80 and 443, the skill runs the deployment behind it
(`skills/lawoss-selfhost/references/existing-proxy.md`): the agent changes
neither the firewall nor the existing proxy, binds the deployment's ports to
the address the proxy reaches the host on, and writes a TLS-passthrough
forwarding file that the human installs. It uses the `init` options
`--http-port`, `--https-port` and `--proxy-bind`, available since
lawoss-selfhost 0.2.0.

## Pinned release

| Field | Value |
|---|---|
| Version | 0.2.0 |
| Repository | `Omni-Legal-Products/lawoss-selfhost` (AGPL-3.0) |
| Commit | `29440f8af25792e42b4c764f8334ec9be239439b` |
| Release record | `skills/lawoss-selfhost/release/0.2.0.json` |
| Record SHA-256 | `425865a7262019e6d77c7b847b9a42cdc8b0c4ae02b9358dd3ed39ccbc5f38b3` |
| Auth image | `ghcr.io/omni-legal-products/lawoss-auth@sha256:014b41f319cc634bea50aee8a14380bbf6623ee56a3041d7912396f3e636dde7` |
| Hub image | `ghcr.io/omni-legal-products/lawoss-hub@sha256:c9bd106d579e842109052b73e0f2e179bdbe440cb7936c41dd62d23bc12f7714` |

The release record is the release workflow's artifact, copied byte for byte.
`releases.json` records it as a regular release with
`distribution: "selfhost-skill"`; `scripts/validate.py` refuses the plugin when
the bundled record does not hash to the pinned value or names another commit
or other images, or when the plugin ships an MCP configuration, a runtime or
scripts. A new lawoss-selfhost release needs a new reviewed catalog commit.

This package ships no MCP configuration, server, runtime, endpoint, OAuth
client or credentials. Usage guidance for people who connect to a finished
server is in the separate `lawoss-remote-skills` plugin.

Maintainer review of the skill text is required before merging. After the
review branch is merged, install the skill with
`codex plugin add lawoss-selfhost@lawoss` or
`/plugin install lawoss-selfhost --marketplace Omni-Legal-Products/lawoss-marketplace`.
