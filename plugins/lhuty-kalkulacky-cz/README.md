# Lhůty a kalkulačky ČR · LAWOSS

Skill-only plugin with two skills: `cz-lhuty` computes Czech procedural and
substantive deadlines deterministically (deemed delivery, end-of-period
shifting, the different tax-code arithmetic) and ships control cases the agent
must pass before use; `cz-kalkulacky` guides court fees, the attorney tariff
and statutory late payment interest, always reading current rates from the
law in force instead of hard-coding them.

Results are drafts for review by an attorney. The deadline rules follow the
LAWOSS research note on Czech deadline computation (2026-08-15); the cited
provisions were re-read from e-Sbírka on 2026-10-22. This package ships no MCP
configuration, server, runtime or credentials.

Authored as in-repository guidance in `plugins/lhuty-kalkulacky-cz`, recorded in
`releases.json` under `inRepoSkills`. Maintainer review of the skill text is
required before merging. No separate runtime is approved or distributed.

After the review branch is merged, install the skill with
`codex plugin add lhuty-kalkulacky-cz@lawoss` or
`/plugin install lhuty-kalkulacky-cz --marketplace Omni-Legal-Products/lawoss-marketplace`.
