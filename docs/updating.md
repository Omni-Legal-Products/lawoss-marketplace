# Updating installed LAWOSS plugins

Use the updater to refresh one configured Git marketplace and reinstall only the
plugins already installed from that marketplace:

```sh
python3 scripts/update_plugins.py --marketplace lawoss
python3 scripts/update_plugins.py --marketplace lawoss --apply
```

The first command is a preview. It reads the configured marketplace and plugin
lists, prints the installed LAWOSS plugins it selected, and makes no changes.
The second command refreshes the named Git marketplace, reinstalls each selected
plugin, reports its previous and resulting version, and stops on the first
failed refresh or installation. Start a new Codex session afterward so it loads
the refreshed plugin files.

The updater filters the CLI response again by marketplace name and installed
state. Available but uninstalled plugins and plugins from other marketplaces
are never added.

Codex currently enables a disabled plugin when `codex plugin add` reinstalls it.
If any selected plugin is disabled, `--apply` therefore exits before refreshing
or reinstalling anything. Enable it deliberately before updating, or keep the
current installation. The preview remains safe and shows its disabled state.

Only a marketplace whose JSON metadata reports `sourceType` as `git` can be
refreshed. A local-path marketplace can be previewed, but `--apply` exits before
changes because there is no Git snapshot for Codex to upgrade. Configure the
released Git source with `codex plugin marketplace add`, then use its reported
marketplace name. You can inspect the source type without changing it:

```sh
codex plugin marketplace list --json
```

The script invokes no login or authentication command. Command failures are
reported by operation and exit status without reproducing CLI output that could
contain credentials.
