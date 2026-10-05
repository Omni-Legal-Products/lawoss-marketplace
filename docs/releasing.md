# Release CRZ

CRZ is released like every other runtime plugin since plugin version 1.4.3. Use the generic [runtime release guide](RELEASES.md):

```sh
python3 scripts/release_plugin.py --plugin crz --source "$CRZ_REVIEWED_CHECKOUT" --version 1.4.4 --output "$RELEASE_OUTPUT"
```

The reviewed source revision is recorded in `releases.json`. Updating an MCP repository does not automatically approve its contents for public distribution. Review a new source revision and update that record first. The builder always exports the exact recorded commit, even if the source checkout has unrelated working changes.

A source commit and a plugin version are separate identifiers: packaging, launcher or skill changes also need a new plugin version. Reusing a version for changed files can leave clients on cached content.

The usage skill comes from the reviewed catalog commit. A skill changed in the source repository must first be adapted and reviewed in the catalog; the builder does not overwrite the local usage instructions with upstream server setup instructions.

## Why CRZ moved to the generic path

Until 1.4.2 CRZ shipped its own older launcher and no `runtime-config.json`. Clients that recognize a LAWOSS bundled runtime by `runtime-config.json` plus `scripts/run.mjs` (for example the LAWOSS app) therefore did not rewrite the relative launcher path to the plugin root, and the MCP closed its connection on start when the client's working directory was not the plugin root. Version 1.4.3 repackages the same reviewed source commit with the shared launcher, `runtime-config.json` and a provenance that includes the configuration hash.

## Client update and rollback

Use the [client update command](updating.md) after merging a release. For rollback, restore the previous approved plugin files, release record and Claude projection in a new catalog commit, then run the same updater. Do not rewrite the shared branch history. The earlier runtime cache is reusable when its checksum matches.
