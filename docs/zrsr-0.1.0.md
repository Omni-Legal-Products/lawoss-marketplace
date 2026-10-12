# ŽRSR skill-only 0.1.0 acceptance

The plugin contains usage guidance for a separately configured ŽRSR MCP.
It ships no runtime, MCP connection, service URL or credentials. Maintainer
review of the skill text remains required before merging the release branch.

Verified 2026-10-12:

- 42 destination Python tests passed with Node.js 24 available.
- The public-tree and semantic catalog validator passed for 17 plugins.
- Claude strict catalog and plugin validation passed.
- The real Codex plugin reader loaded the skill and reported no MCP servers.
- Codex CLI 0.144.0-alpha.4 installed and removed `zrsr@lawoss` in an isolated
  profile from the local review catalog. The operator profile was untouched.
- Instruction mirrors are identical and the diff has no whitespace errors.

The external plugin-creator validation script is absent from the installed
Codex skills, so actual isolated Codex installation was used instead. This
skill-only package has no runtime to start, update or roll back. Remote Git
catalog propagation is verified separately after the review branch is pushed.

No successful production record retrieval or complete register coverage is
claimed. Runtime distribution requires its own organization source release.
