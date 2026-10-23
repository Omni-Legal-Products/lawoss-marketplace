# Katastr nemovitostí ČR · LAWOSS

Skill-only plugin for the free REST API of the Czech cadastre (ČÚZK). Every
request needs the user's own free API key, obtained through ČÚZK service
registration and read from an environment variable at run time. The key is
never part of this package. The API cannot search by owner, and its data are
not an official extract.

Endpoints were checked against the published OpenAPI specification on
2026-10-22; an authenticated request was not run. This package ships no MCP
configuration, server, runtime, key or other credentials.

Authored as in-repository guidance in `plugins/katastr-cz`, recorded in
`releases.json` under `inRepoSkills`. Maintainer review of the skill text is
required before merging. No separate runtime is approved or distributed.

After the review branch is merged, install the skill with
`codex plugin add katastr-cz@lawoss` or
`/plugin install katastr-cz --marketplace Omni-Legal-Products/lawoss-marketplace`.
