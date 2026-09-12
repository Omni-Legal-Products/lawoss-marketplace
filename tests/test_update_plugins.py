import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UPDATER = ROOT / "scripts" / "update_plugins.py"


FAKE_CODEX = r'''#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

state = json.loads(os.environ["FAKE_CODEX_STATE"])
with Path(os.environ["FAKE_CODEX_LOG"]).open("a", encoding="utf-8") as log:
    log.write(json.dumps(sys.argv[1:]) + "\n")

args = sys.argv[1:]
if args == ["app-server", "--stdio"]:
    for line in sys.stdin:
        request = json.loads(line)
        if "id" not in request:
            continue
        if request["method"] == "config/value/write":
            with Path(os.environ["FAKE_CODEX_LOG"]).open("a") as log:
                log.write(json.dumps(["config-write", request["params"]]) + "\n")
        print(json.dumps({"id": request["id"], "result": {}}), flush=True)
    raise SystemExit(0)
elif args == ["plugin", "marketplace", "list", "--json"]:
    result = {"marketplaces": state["marketplaces"]}
elif args[:2] == ["plugin", "list"]:
    result = state["plugin_list"]
elif args[:3] == ["plugin", "marketplace", "upgrade"]:
    if state.get("fail_refresh"):
        print("fixture refresh failure", file=sys.stderr)
        raise SystemExit(7)
    result = {"upgraded": [args[3]]}
elif args[:2] == ["plugin", "add"]:
    if args[2] in state.get("fail_install", []):
        print("fixture install failure", file=sys.stderr)
        raise SystemExit(8)
    result = {
        "pluginId": f"{args[2]}@{args[4]}",
        "name": args[2],
        "marketplaceName": args[4],
        "version": state.get("new_versions", {}).get(args[2], "2.0.0"),
    }
else:
    print(f"unexpected arguments: {args!r}", file=sys.stderr)
    raise SystemExit(9)
print(json.dumps(result))
'''


class UpdatePluginsTest(unittest.TestCase):
    def run_updater(self, state, *arguments):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake = root / "codex"
            fake.write_text(FAKE_CODEX, encoding="utf-8")
            fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
            log = root / "calls.jsonl"
            env = {
                **os.environ,
                "PATH": str(root) + os.pathsep + os.environ.get("PATH", ""),
                "FAKE_CODEX_STATE": json.dumps(state),
                "FAKE_CODEX_LOG": str(log),
            }
            result = subprocess.run(
                [sys.executable, str(UPDATER), *arguments],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            calls = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()] if log.exists() else []
            return result, calls

    def test_preview_selects_only_installed_plugins_from_named_marketplace(self):
        state = {
            "marketplaces": [
                {
                    "name": "lawoss",
                    "root": "/cache/lawoss",
                    "marketplaceSource": {"sourceType": "git", "source": "https://github.com/example/lawoss.git"},
                }
            ],
            "plugin_list": {
                "installed": [
                    {"name": "crz", "marketplaceName": "lawoss", "version": "1.4.0", "installed": True, "enabled": True},
                    {"name": "other", "marketplaceName": "elsewhere", "version": "9.0.0", "installed": True, "enabled": True},
                ],
                "available": [
                    {"name": "not-installed", "marketplaceName": "lawoss", "version": "1.0.0", "installed": False, "enabled": True}
                ],
            },
        }

        result, calls = self.run_updater(state, "--marketplace", "lawoss")

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("crz@lawoss 1.4.0 (enabled)", result.stdout)
        self.assertNotIn("other", result.stdout)
        self.assertNotIn("not-installed", result.stdout)
        self.assertEqual(
            calls,
            [
                ["plugin", "marketplace", "list", "--json"],
                ["plugin", "list", "--marketplace", "lawoss", "--json"],
            ],
        )

    def test_apply_refreshes_git_marketplace_then_reinstalls_selected_plugins(self):
        state = {
            "marketplaces": [{
                "name": "lawoss",
                "root": "/cache/lawoss",
                "marketplaceSource": {"sourceType": "git", "source": "https://github.com/example/lawoss.git"},
            }],
            "plugin_list": {
                "installed": [
                    {"name": "crz", "marketplaceName": "lawoss", "version": "1.4.0", "installed": True, "enabled": True},
                    {"name": "slovlex", "marketplaceName": "lawoss", "version": "1.2.0", "installed": True, "enabled": True},
                    {"name": "foreign", "marketplaceName": "elsewhere", "version": "5.0.0", "installed": True, "enabled": True},
                ],
                "available": [],
            },
            "new_versions": {"crz": "1.5.0", "slovlex": "1.3.0"},
        }

        result, calls = self.run_updater(state, "--marketplace", "lawoss", "--apply")

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("crz@lawoss: updated 1.4.0 -> 1.5.0", result.stdout)
        self.assertIn("slovlex@lawoss: updated 1.2.0 -> 1.3.0", result.stdout)
        self.assertIn("Start a new Codex session", result.stdout)
        self.assertEqual(
            calls[2:],
            [
                ["plugin", "marketplace", "upgrade", "lawoss", "--json"],
                ["plugin", "add", "crz", "--marketplace", "lawoss", "--json"],
                ["plugin", "add", "slovlex", "--marketplace", "lawoss", "--json"],
            ],
        )

    def test_apply_preserves_disabled_state_even_after_failed_install(self):
        state = {
            "marketplaces": [{
                "name": "lawoss",
                "root": "/cache/lawoss",
                "marketplaceSource": {"sourceType": "git", "source": "https://github.com/example/lawoss.git"},
            }],
            "plugin_list": {
                "installed": [
                    {"name": "crz", "marketplaceName": "lawoss", "version": "1.4.0", "installed": True, "enabled": False}
                ],
                "available": [],
            },
        }

        result, calls = self.run_updater(state, "--marketplace", "lawoss", "--apply")

        self.assertEqual(result.returncode, 0, result.stderr)
        writes = [call[1] for call in calls if call[0] == "config-write"]
        expected = {"keyPath": 'plugins."crz@lawoss".enabled', "value": False, "mergeStrategy": "replace"}
        self.assertEqual(writes, [expected, expected])
        state["fail_install"] = ["crz"]
        result, calls = self.run_updater(state, "--marketplace", "lawoss", "--apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls[-1], ["config-write", expected])

    def test_invalid_enabled_state_stops_before_mutation(self):
        for value in (None, "false", 0):
            state = {"marketplaces": [{"name": "lawoss", "marketplaceSource": {"sourceType": "git"}}],
                     "plugin_list": {"installed": [{"name": "crz", "marketplaceName": "lawoss", "installed": True, "enabled": value}]}}
            result, calls = self.run_updater(state, "--marketplace", "lawoss", "--apply")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("valid enabled state", result.stderr)
            self.assertEqual(len(calls), 2)

    def test_refresh_failure_stops_before_any_install(self):
        state = {
            "marketplaces": [{
                "name": "lawoss",
                "root": "/cache/lawoss",
                "marketplaceSource": {"sourceType": "git", "source": "https://github.com/example/lawoss.git"},
            }],
            "plugin_list": {
                "installed": [
                    {"name": "crz", "marketplaceName": "lawoss", "version": "1.4.0", "installed": True, "enabled": True}
                ],
                "available": [],
            },
            "fail_refresh": True,
        }

        result, calls = self.run_updater(state, "--marketplace", "lawoss", "--apply")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("marketplace refresh for lawoss failed (exit 7)", result.stderr)
        self.assertNotIn("fixture refresh failure", result.stderr)
        self.assertEqual(calls[-1], ["plugin", "marketplace", "upgrade", "lawoss", "--json"])
        self.assertFalse(any(call[:2] == ["plugin", "add"] for call in calls))

    def test_install_failure_reports_plugin_and_stops_remaining_installs(self):
        state = {
            "marketplaces": [{
                "name": "lawoss",
                "root": "/cache/lawoss",
                "marketplaceSource": {"sourceType": "git", "source": "https://github.com/example/lawoss.git"},
            }],
            "plugin_list": {
                "installed": [
                    {"name": "crz", "marketplaceName": "lawoss", "version": "1.4.0", "installed": True, "enabled": True},
                    {"name": "slovlex", "marketplaceName": "lawoss", "version": "1.2.0", "installed": True, "enabled": True},
                ],
                "available": [],
            },
            "fail_install": ["crz"],
        }

        result, calls = self.run_updater(state, "--marketplace", "lawoss", "--apply")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("install for crz@lawoss failed (exit 8)", result.stderr)
        self.assertNotIn(["plugin", "add", "slovlex", "--marketplace", "lawoss", "--json"], calls)

    def test_apply_rejects_local_marketplace_before_mutation(self):
        state = {
            "marketplaces": [{
                "name": "lawoss",
                "root": "/checkout/lawoss",
                "marketplaceSource": {"sourceType": "local", "source": "/checkout/lawoss"},
            }],
            "plugin_list": {"installed": [], "available": []},
        }

        result, calls = self.run_updater(state, "--marketplace", "lawoss", "--apply")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("uses a local source", result.stderr)
        self.assertEqual(len(calls), 2)

    def test_unsafe_marketplace_or_plugin_names_never_reach_mutating_commands(self):
        base = {
            "marketplaces": [{
                "name": "lawoss",
                "root": "/cache/lawoss",
                "marketplaceSource": {"sourceType": "git", "source": "https://github.com/example/lawoss.git"},
            }],
            "plugin_list": {"installed": [], "available": []},
        }
        with self.subTest("marketplace"):
            result, calls = self.run_updater(base, "--marketplace", "lawoss;remove", "--apply")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("unsafe marketplace name", result.stderr)
            self.assertEqual(calls, [])

        with self.subTest("plugin"):
            state = json.loads(json.dumps(base))
            state["plugin_list"]["installed"] = [{
                "name": "../escape",
                "marketplaceName": "lawoss",
                "version": "1.0.0",
                "installed": True,
                "enabled": True,
            }]
            result, calls = self.run_updater(state, "--marketplace", "lawoss", "--apply")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("unsafe plugin name", result.stderr)
            self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
