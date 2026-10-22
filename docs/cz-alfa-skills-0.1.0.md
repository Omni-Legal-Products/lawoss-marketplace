# Czech skill-only plugins 0.1.0 acceptance

Four skill-only plugins for Czech law, proposed by VŘ for the LAWOSS alpha
(call of 2026-10-19: basic Czech skills, no paid sources, a simple free
source for case law):

| Plugin | Skills | Source |
|---|---|---|
| `esbirka` | `cz-predpisy-esbirka` | public e-Sbírka, point-in-time text, no key |
| `judikatura-cz` | `cz-judikatura` | Ministry of Justice open data (general courts); NS, NSS and ÚS public search |
| `lhuty-kalkulacky-cz` | `cz-lhuty`, `cz-kalkulacky` | deterministic deadline code; rates read from e-Sbírka |
| `katastr-cz` | `cz-katastr` | ČÚZK cadastre REST API with the user's own free key |

None ships a runtime, MCP connection, service configuration or credentials.
Maintainer review of the skill text remains required before merging.

Verified 2026-10-22:

- e-Sbírka returned the metadata and the paragraph text of Act No. 99/1963 Coll.
  for a given date without a key. Every provision the skills cite was read
  from it on that date.
- The Ministry of Justice open-data API returned year, day and page indexes and
  a full anonymised decision without a key.
- The NS, NSS and NALUS search pages were reachable. No machine API for them
  was verified, and the skill says so.
- The ČÚZK API returned HTTP 401 without a key; endpoints were checked against
  its published OpenAPI 1.0 specification. No authenticated request was run.
- The control cases in `cz-lhuty` reproduce the expected dates from the LAWOSS
  deadline research note (2026-08-15) when the embedded code is executed.
- 42 Python tests passed, the public-tree and semantic catalog validator passed
  for 21 plugins, and Claude strict validation passed for the catalog and for
  each new plugin.
- Claude Code installed all four plugins from a local catalog in an isolated
  profile. Codex CLI is not installed in the authoring environment, so the
  isolated Codex install acceptance is still to be run by a maintainer.

The validator allow-list now names the seven official Czech public-sector
hosts the skills reference. The `cz-zaklad` bundle stays `provisional` until
the maintainer decides otherwise.
