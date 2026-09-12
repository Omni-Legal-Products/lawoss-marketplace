# Release CRZ from one place

The reviewed source revision is recorded in `releases.json`. Updating an MCP repository does not automatically approve its contents for public distribution. Review a new source revision and update that record first. The release builder always exports the exact recorded commit, even if the source checkout has unrelated working changes.

## Maintainer command

From a clean, committed catalog checkout:

```sh
python3 scripts/release_crz.py --source "$CRZ_REVIEWED_CHECKOUT" --version 1.4.1 --output "$RELEASE_OUTPUT"
```

Choose a new output directory outside both checkouts. The command runs the source tests and build, packages the runtime, sets the plugin version, synchronizes the Claude projection and validates the candidate. Failures leave the input checkout unchanged and do not expose a partial candidate. The output is a complete catalog directory plus `release-candidate.json`, identifying the exact source, catalog commit and runtime digest. It contains no Git credentials or source checkout.

Review the candidate diff, run the repository checks and Codex update rehearsal, then release the changed plugin and catalog files together. A source commit and a plugin version are separate identifiers: packaging/skill changes also need a new plugin version. Reusing a version for changed files can leave clients on cached content.

The usage skill and launcher come from the reviewed catalog commit. A skill changed in the source repository must first be adapted and reviewed in the catalog; the builder does not overwrite the local usage instructions with upstream server setup instructions.

## GitHub Actions

The **Prepare CRZ release** workflow accepts the new plugin version. It checks out the recorded source, builds and validates the candidate, exercises its CLI, uploads the candidate and pushes a dedicated release branch with a comparison link in the run summary. The maintainer opens the release PR from that comparison link or with GitHub CLI. This works when organization policy prevents Actions from creating pull requests. The workflow never merges changes or deploys a hosted server.

Activation requires the workflow on the catalog default branch, and a repository secret named `LAWOSS_SOURCE_READ_TOKEN` with **contents read only** access to the CRZ source repository. The default catalog token cannot read a different private repository. Use a narrowly scoped token or replace that checkout token with a short-lived GitHub App token. The source token is not persisted in Git configuration, passed to source tests, or included in artifacts. Do not enable this credential on workflows triggered by untrusted pull requests.

The same candidate can be handed to an authorized private service operator. Hosted deployment is independent of public plugin publication; a marketplace update alone does not deploy a server.

## Client update and rollback

Use the [client update command](updating.md) after merging a release. For rollback, restore the previous approved plugin files, release record and Claude projection in a new catalog commit, then run the same updater. Do not rewrite the shared branch history. The earlier runtime cache is reusable when its checksum matches.

## Validation boundary

Local Codex installation, version update and rollback have a dedicated isolated rehearsal (`scripts/rehearse_update.py`). Hosted Actions permissions and cross-repository access need a real workflow run after activation; local tests do not establish those permissions. A candidate is not a public release until its PR is reviewed and merged.
