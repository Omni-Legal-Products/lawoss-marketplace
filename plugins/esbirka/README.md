# Předpisy ČR (e-Sbírka) · LAWOSS

Skill-only plugin for Czech legislation. The skill reads the public e-Sbírka
(Collection of Laws of the Czech Republic) over HTTPS, including the text in
force on a given date, and enforces exact citations with a link for human
verification. No key or registration is needed.

The endpoint used is the one behind the public e-Sbírka web application. It
is not a contractually guaranteed third-party API; it was verified on
2026-10-22. This package ships no MCP configuration, server, runtime,
endpoint configuration or credentials.

Authored as in-repository guidance in `plugins/esbirka`, recorded in
`releases.json` under `inRepoSkills`. Maintainer review of the skill text is
required before merging. No separate runtime is approved or distributed.

After the review branch is merged, install the skill with
`codex plugin add esbirka@lawoss` or
`/plugin install esbirka --marketplace Omni-Legal-Products/lawoss-marketplace`.
