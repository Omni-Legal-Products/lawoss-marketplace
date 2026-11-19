# Self-hosted LAWOSS server · LAWOSS

Skill-only plugin that walks an AI agent, together with the person who owns
the server, through deploying
[lawoss-selfhost](https://github.com/Omni-Legal-Products/lawoss-selfhost/tree/d041ee6fb116a65dde7201fb4c7d15bbb0b51256)
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

## Pinned release

| Field | Value |
|---|---|
| Version | 0.1.0 |
| Repository | `Omni-Legal-Products/lawoss-selfhost` (AGPL-3.0) |
| Commit | `d041ee6fb116a65dde7201fb4c7d15bbb0b51256` |
| Release record | `skills/lawoss-selfhost/release/0.1.0.json` |
| Record SHA-256 | `6f96cd390968ecfee44c34057b5d61705391ffa91953791cb463d286edfcedde` |
| Auth image | `ghcr.io/omni-legal-products/lawoss-auth@sha256:93e84a8a52d3286b07cc1fd231dc4d679db5e15ecf27daf8dc510876390bc1ea` |
| Hub image | `ghcr.io/omni-legal-products/lawoss-hub@sha256:c86179af9093b1b26405da51aedcd343e66b33bf90a61018a21e12e08e667ea7` |

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
