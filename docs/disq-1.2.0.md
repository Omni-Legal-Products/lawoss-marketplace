# DISQ 1.2.0 acceptance

Source: `Omni-Legal-Products/mcp-diskvalifikacie` commit `b6d3d3033717af94d0fe876bcd64a3c479866df4` (PR #6 into `codex/lawoss-release-2026-09-05`): a port of the audit fixes of 9 October 2026 (`6a344054`) plus lockfile-only `npm audit fix` commits for runtime (`f3d4f3ce`) and development dependencies (`b6d3d303`).

- Fix: `disq_check` reports a name match, not a finding about a person. Every match carries `matchType` (`exact` or `prefix`); new `nameMatchFound`, `identityVerified: false` and `exactNameMatches`. The source matches each query word as a word prefix, so "Tibor X" also returns "Tiborné X". `disqualified` remains as a deprecated alias.
- Fix: academic titles and single-letter initials are removed before querying. The source returned no record for "Ing. <name> <surname>" or "M. <surname>" although the person is in the register. The removal is reported in `warnings`; a query left empty is rejected before reaching the source.
- Fix: `currentlyDisqualified` uses the calendar day in Europe/Bratislava instead of the UTC date, which was wrong for about two hours after midnight. Both ends stay inclusive; `evaluatedOn` and `intervalBasis` state the assumption. Impossible or reversed intervals add `DISQUALIFICATION_INTERVAL_INVALID`.
- Fix: a detail lookup answered with HTTP 404 returns `DISQ_NOT_FOUND` instead of the generic `DISQ_HTTP`.
- Fix: the detail description no longer presents the record's `updateDate` as source freshness. The catalog skill gained the matching pitfalls.
- Fix: the runtime lockfile resolves the advisories reported by `npm audit --omit=dev` within the declared ranges: `@modelcontextprotocol/sdk` 1.29.0 → 1.32.1 (GHSA-6qxp-vccf-f47h), `proxy-addr` 2.0.7 → 2.0.8 (GHSA-jqcg-44mw-7w3h), `fast-uri` 3.1.7 → 3.1.8, `ip-address` 10.7.0 → 10.7.4.
- Dev-only: `vitest` 4.1.11 and `source-map-js` resolve the remaining `npm audit` advisories; source CI is green on `b6d3d303`.
- Source tests: 154 passed (14 new regression tests on anonymized captures of the live source; 13 fail on the previous release commit), 15 documentation contract tests passed; TypeScript build passed.
- Catalog: see the checks listed in the pull request.
- Packaged runtime smoke (stdio, live DISQ read, 2026-10-12): 2 tools; "Ing. Milan S." case returned `matches` with the title removed and an `exact` match; the "Tibor/Tiborné" case returned one `exact` and one `prefix` match; a detail returned `currentlyDisqualified: true` with `evaluatedOn` 2026-10-12; the "M. S." case returned `QUERY_INITIALS_REMOVED_BROADENED`; an unknown `registreGuid` returned `DISQ_NOT_FOUND` with `isError`.

Pending before merge: Codex plugin-creator validator and isolated Git-marketplace install/update/rollback acceptance, unless the owner waives them.

Tests establish behavior for the captured responses and a selected live read. They do not establish a person's identity or the legal effect of the disqualification period's end date.
