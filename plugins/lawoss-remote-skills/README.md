# LAWOSS skills for a self-hosted server · LAWOSS

Skill-only plugin for users whose LAWOSS services run on a self-hosted
`lawoss-selfhost` server. Install it next to the remote connections to that
server. It ships no MCP configuration, server, runtime, endpoint, OAuth client
or credentials, and it starts no local Node process. Each connection to the
server is configured separately by the user or the administrator.

It contains one remote edition of every usage skill of the 14 version 1
services: CRZ, DISQ, EUR-Lex, Finančná správa, Judikáty, Kalkulačky, ORSR,
Obchodný vestník, RPO, RPVS, Register úpadcov, RÚZ, Slov-Lex and ÚVO. Each
skill is named `<local skill>-remote`, so it does not collide with the local
skill when a local plugin is installed as well.

## How the skills are made

The skills are generated; do not edit them by hand. Run

```bash
python3 scripts/build_remote_skills.py          # regenerate
python3 scripts/build_remote_skills.py --check  # exit 1 if the committed output differs
```

The generator copies each local usage skill and:

- renames it with the `-remote` suffix and says in its description that it is
  for a self-hosted server;
- puts a one-line notice under the title that names the tools the server does
  not offer;
- removes the local setup sections listed per skill (local CLI, transport,
  authentication) and the catalog note about the bundled local runtime, and
  replaces reviewed passages that point to tools the server does not offer.
  It fails when a listed section or passage no longer matches the source, or
  when a local CLI mention survives;
- appends a Slovak `## Vzdialený režim` section that lists the tools the server
  does not offer (they answer "Tento nástroj je dostupný len v lokálnom
  plugine."), the tools offered without their file-saving arguments, and what
  to use instead, including the local plugin for files and saved state.

The tool policy comes from `scripts/remote_skills_policy.json`, a copy of
`hub/services.json` in `Omni-Legal-Products/lawoss-selfhost` at the commit
recorded in that file. Refresh the copy and regenerate when the hub policy
changes. The local plugins are not modified.

Authored as in-repository guidance in `plugins/lawoss-remote-skills`, recorded
in `releases.json` under `inRepoSkills`. Maintainer review of the generated
skill text is required before merging.

After the review branch is merged, install the skills with
`codex plugin add lawoss-remote-skills@lawoss` or
`/plugin install lawoss-remote-skills --marketplace Omni-Legal-Products/lawoss-marketplace`.
