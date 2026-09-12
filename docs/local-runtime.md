# Local runtime pilot acceptance

## Scope

CRZ only. Remaining 14 catalog entries still provide guidance; they do not yet install local MCP or CLI. The marketplace is not an all-server local bundle until each entry passes its own gate. No hosted transport is permitted in LAWOSS.

## Build and validation

The packaging script reads the reviewed commit from releases.json and exports it with git archive. An operator supplies a checkout containing that commit:

```sh
python3 scripts/package_crz.py --source "$CRZ_REVIEWED_CHECKOUT"
python3 -m unittest discover -s tests -v
python3 scripts/validate.py
claude plugin validate --strict .
cmp AGENTS.md CLAUDE.md
python3 scripts/rehearse_update.py
```

The build runs the source tests before creating an inspectable 228 KB runtime with a lockfile, license and SHA-256 manifest. The recorded source version is 1.3.1; plugin packaging has its own version. Runtime dependency downloads are not bundled in that size.

## Verified on 12 September 2026

- macOS arm64, Node 26.7.0. The declared Node 22.13 floor has not yet been exercised on that exact version.
- 86 source tests and successful TypeScript build.
- CLI enumerates 10 tools and crz_recent with limit=1 returns a real contract.
- Actual Codex plugin install in an isolated profile starts stdio and completes the same read.
- Git catalog refresh tested against a temporary localhost HTTP Git fixture, with isolated Codex profile. This tests Git snapshot/update behavior; GitHub organization permissions are a separate release check.
- A changed plugin/runtime/skill is picked up after refresh and reinstall. Runtime cache changes with content, and rollback reuses the previous cache.
- Warm CLI startup succeeds with an empty PATH: no npm or dependency download is required. This does not establish that live CRZ data can be queried offline.
- Paths containing spaces, relative cache roots, corrupted runtime/cache and malformed CLI arguments are covered.

Codex resolves the plugin cwd; it did not expand the Claude plugin-root variable in MCP args during the real installation test. The shipped Codex configuration therefore uses cwd plus a relative launcher path. Claude catalog schema validation passes; Claude runtime, Windows and Linux acceptance are still unverified.

The first startup may take up to the configured 300-second startup timeout while dependencies install. A missing Node/npm prerequisite or failed installation reports to stderr. A failed install is not marked ready; retry creates a fresh staging directory. Cache hashes detect accidental runtime corruption, not a malicious publisher changing both a file and its hash.

## Further rollout

For each remaining entry, identify reviewed runtime and entrypoint, package only reviewed files, preserve licenses, implement its CLI adapter, run a real clean-install read and Git update/rollback test, and only then add local transport. CZ alpha services retain their data limitations even when transport works.
