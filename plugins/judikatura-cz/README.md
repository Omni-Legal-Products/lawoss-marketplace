# Judikatura ČR · LAWOSS

Skill-only plugin for Czech case law from free public sources. Decisions of
district, regional and high courts come from the Ministry of Justice open-data
API (`rozhodnuti.justice.cz`, JSON, no key). The Supreme Court, the Supreme
Administrative Court and the Constitutional Court (NALUS) are reached through
their public web search; no machine API for them was verified.

Paid databases are not used. This package ships no MCP configuration, server,
runtime or credentials. Sources were verified as reachable on 2026-10-22.

Authored as in-repository guidance in `plugins/judikatura-cz`, recorded in
`releases.json` under `inRepoSkills`. Maintainer review of the skill text is
required before merging. No separate runtime is approved or distributed.

After the review branch is merged, install the skill with
`codex plugin add judikatura-cz@lawoss` or
`/plugin install judikatura-cz --marketplace Omni-Legal-Products/lawoss-marketplace`.
