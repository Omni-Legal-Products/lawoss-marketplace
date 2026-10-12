# Živnostenský register SR · LAWOSS

Skill-only plugin for the Slovak Trade Register. MCP setup is manual: use an
existing authorized ŽRSR connection configured separately by the user or the
administrator. This package ships no MCP configuration, server, runtime,
endpoint, OAuth client or credentials.

The skill covers name search, eight-digit IČO lookup, multiple registrations,
source provenance, truncated answers, cancelled activities and source errors.
An access-denied response is not evidence that a business does not exist.

Authored as in-repository guidance in `plugins/zrsr`, recorded in `releases.json`
under `inRepoSkills`. Maintainer review of the skill is required before merging.
This release does not approve or distribute a separate ŽRSR runtime.

After the review branch is merged, install the skill with
`codex plugin add zrsr@lawoss` or
`/plugin install zrsr --marketplace Omni-Legal-Products/lawoss-marketplace`.
