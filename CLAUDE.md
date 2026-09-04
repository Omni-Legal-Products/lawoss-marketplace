# LAWOSS Marketplace agent instructions

This repository is a public-safe distribution catalog. Treat every committed
file as publishable even when the repository currently has no remote.

## Distribution boundary

- Source wrapper metadata and skills only from a release-approved LAWOSS
  organization edition at a recorded commit.
- Never copy private upstream content, credentials, tokens, personal hostnames,
  IP addresses, user-specific absolute paths, deployment identifiers, or
  personal operational notes into this repository.
- Do not add `.mcp.json` or `mcpServers` to a wrapper unless a separately
  approved LAWOSS service or portable local launcher has passed clean-install
  verification. Documentation must state when server setup is manual.
- Keep every catalog source under `./plugins/` and verify its resolved path stays
  inside the repository root.
- Add a plugin as `AVAILABLE` only after its organization edition passes the
  complete release gate. Pending projects are not installable catalog entries.

## Required mirrors and checks

- `.agents/plugins/marketplace.json` is canonical. Keep the Claude catalog
  aligned through the validated semantic projection; do not copy Codex-only
  fields into Claude's different schema.
- Keep `AGENTS.md` and `CLAUDE.md` byte-for-byte identical.
- Run `python3 -m unittest discover -s tests -v`,
  `python3 scripts/validate.py`, `claude plugin validate --strict`, the
  plugin-creator validator, and the instruction mirror comparison before
  committing.
- Review the staged file list and sanitization output. Do not publish, push,
  deploy, register an MCP endpoint, or change repository visibility without
  explicit authorization.
