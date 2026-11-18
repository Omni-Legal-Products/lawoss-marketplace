# Katastr nemovitostí ČR · LAWOSS

**Not usable in the LAWOSS app yet.** The skill reads the key from the
`CUZK_API_KEY` environment variable. A LAWOSS user cannot set environment
variables for the engine, and its `execute` sandbox has no `process.env`.
Until the app offers secure key storage for skills, the skill tells the user
it cannot run there and stops. It never asks for the key in the chat, because
conversation text goes to the model provider. It works in hosts that run code
with access to the environment, such as Claude Code or Codex, with the key set
outside the conversation.

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
