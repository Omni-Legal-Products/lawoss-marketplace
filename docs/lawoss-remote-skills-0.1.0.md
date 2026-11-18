# LAWOSS remote skills 0.1.0 acceptance

The plugin contains generated remote editions of the 14 usage skills of the
version 1 services, for users of a self-hosted LAWOSS server. It ships no
runtime, MCP connection, service URL or credentials. Maintainer review of the
generated skill text remains required before merging the review branch.

The tool policy is a copy of `hub/services.json` in
`Omni-Legal-Products/lawoss-selfhost` at
`a33429b80306c2e3b83b528c0043698270176a13`, kept in
`scripts/remote_skills_policy.json`.

Verified 2026-11-18:

- 65 destination Python tests ran: 60 passed, 4 were skipped, and the known
  baseline failure `test_cold_start_reports_missing_npm` failed. It fails on the
  same machine without this change.
- `python3 scripts/build_remote_skills.py --check` reports the committed output
  as current.
- The local plugins' skills are byte-identical to `main`.
- The public-tree and semantic catalog validator passed for 22 plugins.
- Claude strict catalog and plugin validation passed.
- Codex CLI 0.170.0 installed `lawoss-remote-skills@lawoss` in an isolated
  profile from the local review catalog. Its app server listed the 14 remote
  skills and no MCP servers. The plugin was then removed. The operator profile
  was untouched.
- Instruction mirrors are identical.

The external plugin-creator validation script is absent from the installed
Codex skills, so an actual isolated Codex installation was used instead. This
skill-only package has no runtime to start, update or roll back. Remote Git
catalog propagation is verified separately after the review branch is pushed.

No remote tool call against a self-hosted server is claimed. The skill text
describes the hub policy at the recorded commit, not a live server.
