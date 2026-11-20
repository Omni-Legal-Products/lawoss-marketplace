# Self-hosted LAWOSS server · LAWOSS

Skill-only plugin that walks an AI agent, together with the person who owns
the server, through deploying
[lawoss-selfhost](https://github.com/Omni-Legal-Products/lawoss-selfhost/tree/60ff58dfdd6a70f3534f9fe0ff05f3344563cca6)
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
| Version | 0.3.0 |
| Repository | `Omni-Legal-Products/lawoss-selfhost` (AGPL-3.0) |
| Commit | `60ff58dfdd6a70f3534f9fe0ff05f3344563cca6` |
| Release record | `skills/lawoss-selfhost/release/0.3.0.json` |
| Record SHA-256 | `329d5bd454581e2bc16de0bd54d1003fbaf4516c5b251146a4429271881ea22d` |
| Auth image | `ghcr.io/omni-legal-products/lawoss-auth@sha256:2f7bbca3b4052d754b1bcccf0920e8a25795f5b63df8d1c908f27bcbc3feeb08` |
| Hub image | `ghcr.io/omni-legal-products/lawoss-hub@sha256:9aa863847415cf4a3fb48b6b133d249c0cce2a96b64679f2632c4536a28ebab2` |

The release record is the release workflow's artifact, copied byte for byte.
`releases.json` records it as a regular release with
`distribution: "selfhost-skill"`; `scripts/validate.py` refuses the plugin when
the bundled record does not hash to the pinned value or names another commit
or other images, or when the plugin ships an MCP configuration, a runtime or
scripts. A new lawoss-selfhost release needs a new reviewed catalog commit.

Claude connectors: the behind-a-proxy acceptance test of lawoss-selfhost 0.2.0
found that its sign-in server accepted dynamic client registration only for
loopback redirect URIs, so a custom connector in Claude desktop or on
claude.ai failed to register. Since 0.3.0, `init` allows the callback of
Claude's hosted apps (`claude.ai/api/mcp/auth_callback` over `https://`) by
default and prints it on stderr; `init --no-claude-callbacks` allows none, and
the `callbacks list|add|remove` command changes the list later (an update from
0.2.0 starts with an empty list; `callbacks add claude` adds the callback).
Claude desktop and claude.ai connect through Settings → Connectors → custom
connector with `https://<service>.<base>/mcp`, over public port 443; Claude
Code connects through loopback as before. The skill covers this in steps 7 and
12 and in `references/operations.md`. The claude.ai sign-in has not yet been
verified on a live deployment; release 0.3.0 is what makes it available. The
same acceptance test added guidance for servers where `sudo` asks for a
password, the Dokploy file editor, a check that Traefik loaded the forwarding
file before the first start, and certificates that were requested before the
forwarding file worked.

This package ships no MCP configuration, server, runtime, endpoint, OAuth
client or credentials. Usage guidance for people who connect to a finished
server is in the separate `lawoss-remote-skills` plugin.

Maintainer review of the skill text is required before merging. After the
review branch is merged, install the skill with
`codex plugin add lawoss-selfhost@lawoss` or
`/plugin install lawoss-selfhost --marketplace Omni-Legal-Products/lawoss-marketplace`.
