#!/usr/bin/env python3
"""Preview or apply updates for installed plugins from one Codex marketplace."""
import argparse
import json
import re
import selectors
import time
import subprocess
import sys


SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class UpdateError(Exception):
    pass


def run_json(args, operation):
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            check=False,
            timeout=120,
        )
    except subprocess.TimeoutExpired as error:
        raise UpdateError(f"{operation} timed out") from error
    except OSError as error:
        raise UpdateError(f"{operation} could not start: {error.strerror}") from error
    if result.returncode:
        raise UpdateError(f"{operation} failed (exit {result.returncode})")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise UpdateError(f"{operation} returned invalid JSON") from error


def restore_disabled(plugin_id):
    """Use Codex's structured writer; preserve unrelated settings and comments."""
    try:
        process = subprocess.Popen(["codex", "app-server", "--stdio"],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, text=True, bufsize=1)
    except OSError as error:
        raise UpdateError("could not start Codex config writer") from error
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    def request(request_id, method, params):
        process.stdin.write(json.dumps({"id": request_id, "method": method, "params": params}) + "\n")
        process.stdin.flush()
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if not selector.select(max(0, deadline - time.monotonic())):
                break
            line = process.stdout.readline()
            if not line:
                break
            try:
                response = json.loads(line)
            except json.JSONDecodeError:
                continue
            if response.get("id") == request_id:
                if "error" in response:
                    raise UpdateError(f"could not preserve disabled state for {plugin_id}")
                return response.get("result")
        raise UpdateError(f"config writer timed out for {plugin_id}")
    try:
        request(1, "initialize", {"clientInfo": {"name": "lawoss-updater", "version": "1"}})
        process.stdin.write(json.dumps({"method": "initialized"}) + "\n")
        process.stdin.flush()
        request(2, "config/value/write", {
            "keyPath": 'plugins.' + json.dumps(plugin_id) + '.enabled',
            "value": False, "mergeStrategy": "replace",
        })
    finally:
        selector.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        process.stdin.close()
        process.stdout.close()


def require_name(value, label):
    if not SAFE_NAME.fullmatch(value):
        raise UpdateError(f"unsafe {label}: {value!r}")


def load_state(marketplace):
    marketplace_data = run_json(
        ["codex", "plugin", "marketplace", "list", "--json"],
        "marketplace lookup",
    )
    if not isinstance(marketplace_data, dict) or not isinstance(marketplace_data.get("marketplaces"), list):
        raise UpdateError("marketplace lookup returned unexpected JSON")
    marketplaces = marketplace_data["marketplaces"]
    selected = next((item for item in marketplaces if item.get("name") == marketplace), None)
    if selected is None:
        raise UpdateError(f"marketplace {marketplace!r} is not configured")

    listing = run_json(
        ["codex", "plugin", "list", "--marketplace", marketplace, "--json"],
        "installed plugin lookup",
    )
    if not isinstance(listing, dict) or not isinstance(listing.get("installed"), list):
        raise UpdateError("installed plugin lookup returned unexpected JSON")
    installed = [
        plugin
        for plugin in listing.get("installed", [])
        if plugin.get("installed") is True and plugin.get("marketplaceName") == marketplace
    ]
    for plugin in installed:
        name = plugin.get("name")
        if not isinstance(name, str):
            raise UpdateError("installed plugin has no valid name")
        require_name(name, "plugin name")
        if not isinstance(plugin.get("enabled"), bool):
            raise UpdateError(f"installed plugin {name!r} has no valid enabled state")
    return selected, installed


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Refresh a Git marketplace and reinstall only its installed plugins."
    )
    parser.add_argument("--marketplace", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)

    try:
        require_name(args.marketplace, "marketplace name")
        marketplace, installed = load_state(args.marketplace)
        source_type = marketplace.get("marketplaceSource", {}).get("sourceType", "unknown")
        print(f"Marketplace: {args.marketplace} ({source_type})")
        print("Installed plugins selected:")
        for plugin in installed:
            state = "enabled" if plugin.get("enabled") is True else "disabled"
            print(f"  {plugin['name']}@{args.marketplace} {plugin.get('version', 'unknown')} ({state})")
        if not installed:
            print("  (none)")
        if args.apply:
            if source_type != "git":
                raise UpdateError(
                    f"marketplace {args.marketplace!r} uses a {source_type} source; "
                    "only Git marketplaces can be refreshed"
                )
            # Verify the writer before reinstall can temporarily enable a plugin.
            for plugin in installed:
                if plugin.get("enabled") is not True:
                    restore_disabled(f"{plugin['name']}@{args.marketplace}")
            run_json(
                ["codex", "plugin", "marketplace", "upgrade", args.marketplace, "--json"],
                f"marketplace refresh for {args.marketplace}",
            )
            print("Marketplace refresh: complete")
            for plugin in installed:
                try:
                    result = run_json(
                        [
                            "codex", "plugin", "add", plugin["name"],
                            "--marketplace", args.marketplace, "--json",
                        ],
                        f"install for {plugin['name']}@{args.marketplace}",
                    )
                finally:
                    if plugin.get("enabled") is not True:
                        restore_disabled(f"{plugin['name']}@{args.marketplace}")
                new_version = result.get("version")
                if not isinstance(new_version, str):
                    raise UpdateError(
                        f"install for {plugin['name']}@{args.marketplace} returned no version"
                    )
                print(
                    f"{plugin['name']}@{args.marketplace}: updated "
                    f"{plugin.get('version', 'unknown')} -> {new_version}"
                )
            print("Start a new Codex session to load the updated plugins.")
            return 0
        print("Preview only; run again with --apply to perform the update.")
        return 0
    except UpdateError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
