# Preparing LAWOSS runtime releases

Runtime releases are built only from the organization repository and exact commit recorded in `releases.json`. The generic release path has a separate hardcoded repository allowlist, requires a clean catalog checkout, and exports that checkout before making changes. It never edits the working catalog in place.

Run a local candidate build with a checkout that contains the reviewed commit:

```bash
python3 scripts/release_plugin.py \
  --plugin disq \
  --source /path/to/reviewed-source \
  --version 1.1.0 \
  --output /path/to/new-candidate
```

The output directory must not exist and must be outside both checkouts. Every runtime plugin, CRZ included since plugin version 1.4.3, uses `package_runtime.build` from the exported candidate. A successful candidate contains the packaged runtime, updated Codex and Claude version projections, the activated `local-mcp-skill-cli` ledger record, and `release-candidate.json` with the source and runtime-manifest identities.

The **Prepare plugin release** workflow accepts one of the 15 catalog plugin names and a new semantic version. It resolves the exact repository and commit through the same independent allowlist, then uses `LAWOSS_SOURCE_READ_TOKEN` only for the private source checkout. The build step does not receive that secret. Configure the secret as a read-only token with access only to the necessary organization source repositories.

Before dispatching the workflow, run the external plugin validators from a reviewed local release environment where the Claude CLI and the bundled Codex `plugin-creator` skill are installed:

```bash
claude plugin validate --strict .
python3 "$CODEX_HOME/skills/.system/plugin-creator/scripts/validate_plugin.py" "plugins/$PLUGIN"
```

These checks are an explicit local release gate. The hosted workflow does not install unreviewed validator packages or replace this prerequisite.

Current Codex releases no longer ship that script: Codex CLI 0.159.3 has no plugin validation command and the curated `plugin-creator` plugin 0.1.26 contains only skills. Where the script is absent, the Codex gate is an actual install in an isolated profile. It installs the plugin from `main`, updates it to the release branch, starts the installed runtime and rolls it back. Record in the plugin's acceptance note which of the two Codex gates ran.

```bash
export CODEX_HOME="$(mktemp -d)" LAWOSS_CACHE_DIR="$(mktemp -d)"
codex plugin marketplace add https://github.com/Omni-Legal-Products/lawoss-marketplace.git --ref main
codex plugin add "$PLUGIN@lawoss"
# set ref = "<release branch>" under [marketplaces.lawoss] in $CODEX_HOME/config.toml
python3 scripts/update_plugins.py --marketplace lawoss --apply   # expect: updated <old> -> <new>
# start $CODEX_HOME/plugins/cache/lawoss/$PLUGIN/<new>/scripts/run.mjs mcp over stdio and call one tool
# set ref back to "main" and run the updater again             # expect: updated <new> -> <old>
```

After source tests, packaging, catalog validation, and local launcher checks pass, the workflow uploads the complete candidate and pushes a release branch. Its summary links to a branch comparison. It does not open or merge a pull request. A reviewer must inspect the comparison, complete platform install/update/rollback acceptance, and decide whether to open a pull request under the organization release policy.

The former CRZ-only release path (`release_crz.py`, `package_crz.py` and the **Prepare CRZ release** workflow) was removed in CRZ 1.4.3 because it produced a runtime without `runtime-config.json` and with a different launcher. The workflow does not publish a repository, deploy a gateway, change authentication, or transfer operator credentials and state.
