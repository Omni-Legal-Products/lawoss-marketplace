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

The output directory must not exist and must be outside both checkouts. For CRZ, this command delegates to `scripts/release_crz.py`, preserving its established package and validation path. Other runtime plugins use `package_runtime.build` from the exported candidate. A successful candidate contains the packaged runtime, updated Codex and Claude version projections, the activated `local-mcp-skill-cli` ledger record, and `release-candidate.json` with the source and runtime-manifest identities.

The **Prepare plugin release** workflow accepts one of the 15 catalog plugin names and a new semantic version. It resolves the exact repository and commit through the same independent allowlist, then uses `LAWOSS_SOURCE_READ_TOKEN` only for the private source checkout. The build step does not receive that secret. Configure the secret as a read-only token with access only to the necessary organization source repositories.

Before dispatching the workflow, run the external plugin validators from a reviewed local release environment where the Claude CLI and the bundled Codex `plugin-creator` skill are installed:

```bash
claude plugin validate --strict .
python3 "$CODEX_HOME/skills/.system/plugin-creator/scripts/validate_plugin.py" "plugins/$PLUGIN"
```

These checks are an explicit local release gate. The hosted workflow does not install unreviewed validator packages or replace this prerequisite.

After source tests, packaging, catalog validation, and local launcher checks pass, the workflow uploads the complete candidate and pushes a release branch. Its summary links to a branch comparison. It does not open or merge a pull request. A reviewer must inspect the comparison, complete platform install/update/rollback acceptance, and decide whether to open a pull request under the organization release policy.

The older **Prepare CRZ release** workflow remains available and unchanged. Neither workflow publishes a repository, deploys a gateway, changes authentication, or transfers operator credentials and state.
