import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CODEX_CATALOG = ROOT / ".agents" / "plugins" / "marketplace.json"
CLAUDE_CATALOG = ROOT / ".claude-plugin" / "marketplace.json"
MARKDOWN_LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")


class MarketplaceValidationTest(unittest.TestCase):
    def _copy_repository(self, directory: str) -> Path:
        destination = Path(directory) / "marketplace"
        shutil.copytree(
            ROOT,
            destination,
            ignore=shutil.ignore_patterns(".git", "__pycache__"),
        )
        return destination

    def _run_validator(self, root: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "validate.py"), "--root", str(root)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_catalogs_share_an_explicit_semantic_projection(self) -> None:
        """Catch Claude/Codex schema drift without conflating their formats."""
        codex = json.loads(CODEX_CATALOG.read_text(encoding="utf-8"))
        claude = json.loads(CLAUDE_CATALOG.read_text(encoding="utf-8"))
        manifest = json.loads(
            (ROOT / "plugins" / "crz" / ".codex-plugin" / "plugin.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertEqual(codex["name"], "lawoss")
        self.assertEqual(codex["interface"], {"displayName": "LAWOSS Marketplace"})
        ledger = json.loads((ROOT / "releases.json").read_text())
        self.assertEqual(len(codex["plugins"]), 16)
        self.assertEqual(
            set(plugin["name"] for plugin in codex["plugins"]),
            set(record["name"] for record in ledger["releases"]) | set(record["name"] for record in ledger["inRepoSkills"]),
        )
        self.assertEqual(claude["name"], "lawoss")
        self.assertEqual(claude.get("owner"), {"name": "LAWOSS"})
        self.assertEqual(
            set(claude), {"name", "owner", "description", "plugins"}
        )
        self.assertEqual([plugin["name"] for plugin in claude["plugins"]], [plugin["name"] for plugin in codex["plugins"]])

        codex_plugin = codex["plugins"][0]
        claude_plugin = claude["plugins"][0]
        self.assertEqual(codex_plugin["source"], {"source": "local", "path": "./plugins/crz"})
        self.assertEqual(
            codex_plugin["policy"],
            {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
        )
        self.assertEqual(
            set(claude_plugin),
            {"name", "source", "description", "version", "category", "tags"},
        )
        self.assertEqual(claude_plugin["source"], "./plugins/crz")

        codex_projection = {
            "marketplace": codex["name"],
            "owner": manifest["author"]["name"],
            "plugin": codex_plugin["name"],
            "description": manifest["description"],
            "category": codex_plugin["category"],
            "version": manifest["version"],
            "source": codex_plugin["source"]["path"],
        }
        claude_projection = {
            "marketplace": claude["name"],
            "owner": claude["owner"]["name"],
            "plugin": claude_plugin["name"],
            "description": claude_plugin["description"],
            "category": claude_plugin["category"],
            "version": claude_plugin["version"],
            "source": claude_plugin["source"],
        }
        self.assertEqual(codex_projection, claude_projection)

        plugin_root = (ROOT / codex_projection["source"]).resolve()
        plugin_root.relative_to(ROOT.resolve())
        self.assertEqual(manifest['mcpServers'], './.mcp.json')
        self.assertTrue((plugin_root / '.mcp.json').exists())
        claude_manifest = json.loads((plugin_root / '.claude-plugin/plugin.json').read_text())
        self.assertEqual(claude_manifest['version'], manifest['version'])
        self.assertEqual(claude_manifest['description'], manifest['description'])

    def test_every_readme_link_resolves_inside_the_marketplace(self) -> None:
        """Catch setup links that require an unavailable external repository."""
        for readme in ROOT.rglob("README.md"):
            for target in MARKDOWN_LINK.findall(readme.read_text(encoding="utf-8")):
                if target.startswith("https://github.com/Omni-Legal-Products/"):
                    self.assertRegex(target, r"/tree/[0-9a-f]{40}$")
                    continue
                self.assertFalse(target.startswith(("http://", "https://")), msg=f"unapproved external README link: {readme}: {target}")
                local_target = target.split("#", 1)[0]
                resolved = (readme.parent / local_target).resolve()
                resolved.relative_to(ROOT.resolve())
                self.assertTrue(resolved.exists(), msg=f"broken README link: {readme}: {target}")

    def test_validator_rejects_private_infrastructure_and_secret_mutations(self) -> None:
        """Catch publication leaks even when they are not written as URLs."""
        mutations = (
            ("RFC1918", "host=" + ".".join(("10", "23", "45", "67")), "private network address"),
            ("CGNAT", "host=" + ".".join(("100", "100", "10", "20")), "private network address"),
            ("Tailscale host", "host=private-node.example." + "ts.net", "private infrastructure hostname"),
            (
                "private deployment host",
                "host=service." + "private." + "internal",
                "private infrastructure hostname",
            ),
            ("Dokploy ID", "--compose" + "Id dp_" + "a" * 24, "deployment identifier"),
            ("secret", "to" + "ken=" + "ghp_" + "A" * 24, "secret signature"),
        )

        for name, payload, expected_error in mutations:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                copied_root = self._copy_repository(directory)
                (copied_root / "probe.txt").write_text(payload + "\n", encoding="utf-8")
                result = self._run_validator(copied_root)

                self.assertNotEqual(result.returncode, 0, msg=name)
                self.assertIn(expected_error, result.stderr)

    def test_validator_rejects_private_dns_and_environment_deployment_ids(self) -> None:
        """Catch two-label private DNS and deployment IDs in config assignments."""
        mutations = (
            ("two-label private DNS", "host=db." + "internal", "private infrastructure hostname"),
            (
                "environment assignment",
                "DOKPLOY_" + "PROJECT_ID=dp_" + "b" * 24,
                "deployment identifier",
            ),
            (
                "JSON assignment",
                '"DOKPLOY_' + 'PROJECT_ID": "dp_' + "c" * 24 + '"',
                "deployment identifier",
            ),
            (
                "YAML assignment",
                "DOKPLOY_" + "PROJECT_ID: dp_" + "d" * 24,
                "deployment identifier",
            ),
        )

        for name, payload, expected_error in mutations:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                copied_root = self._copy_repository(directory)
                (copied_root / "probe.txt").write_text(payload + "\n", encoding="utf-8")
                result = self._run_validator(copied_root)

                self.assertNotEqual(result.returncode, 0, msg=name)
                self.assertIn(expected_error, result.stderr)

        safe_examples = "\n".join(
            (
                "Set DOKPLOY_" + "PROJECT_ID to your authorized deployment ID.",
                "The DOKPLOY_" + "PROJECT_ID environment variable is optional.",
                "DOKPLOY_" + "PROJECT_ID identifies the selected project.",
                "DOKPLOY_" + "PROJECT_ID=<replace-with-project-id>",
                '"DOKPLOY_' + 'PROJECT_ID": "${DOKPLOY_PROJECT_ID}"',
                "DOKPLOY_" + "PROJECT_ID: placeholder-project-id",
            )
        )
        with tempfile.TemporaryDirectory() as directory:
            copied_root = self._copy_repository(directory)
            (copied_root / "safe-placeholders.txt").write_text(
                safe_examples + "\n", encoding="utf-8"
            )
            result = self._run_validator(copied_root)

            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_validator_rejects_path_traversal_and_claude_schema_mutations(self) -> None:
        """Catch source escape and regression to Codex-shaped Claude JSON."""
        with tempfile.TemporaryDirectory() as directory:
            copied_root = self._copy_repository(directory)
            catalog_path = copied_root / ".agents" / "plugins" / "marketplace.json"
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            catalog["plugins"][0]["source"]["path"] = "./plugins/../../outside"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            result = self._run_validator(copied_root)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("source escapes marketplace root", result.stderr)

        with tempfile.TemporaryDirectory() as directory:
            copied_root = self._copy_repository(directory)
            catalog_path = copied_root / ".claude-plugin" / "marketplace.json"
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            catalog["plugins"][0]["source"] = {"path": "./plugins/crz"}
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            result = self._run_validator(copied_root)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Claude plugin source must be a relative path string", result.stderr)

    def test_skill_only_wrapper_cannot_ship_mcp_or_runtime(self) -> None:
        """The Google Workspace skill stays a skill: no MCP transport, runtime or unrecorded plugin."""
        manifest = json.loads((ROOT / "plugins" / "google-workspace-gog" / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["skills"], "./skills/")
        self.assertNotIn("mcpServers", manifest)
        self.assertFalse((ROOT / "plugins" / "google-workspace-gog" / ".mcp.json").exists())
        skill = (ROOT / "plugins" / "google-workspace-gog" / "skills" / "google-workspace" / "SKILL.md").read_text(encoding="utf-8")
        for flag in ("--readonly", "--gmail-no-send", "--dry-run", "--wrap-untrusted", "--no-input", "gog auth setup"):
            self.assertIn(flag, skill)

        for mutation, message in (
            (lambda root: (root / "plugins/google-workspace-gog/.mcp.json").write_text('{"mcpServers": {}}'), "must not declare an MCP transport"),
            (lambda root: (root / "plugins/google-workspace-gog/runtime").mkdir(), "must not ship a runtime"),
        ):
            with tempfile.TemporaryDirectory() as directory:
                copied_root = self._copy_repository(directory)
                mutation(copied_root)
                result = self._run_validator(copied_root)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)

        with tempfile.TemporaryDirectory() as directory:
            copied_root = self._copy_repository(directory)
            ledger_path = copied_root / "releases.json"
            ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
            ledger["inRepoSkills"] = []
            ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
            result = self._run_validator(copied_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("catalog must match reviewed release records", result.stderr)

    def test_lawoss_metadata_carries_categories_jurisdictions_and_bundles(self) -> None:
        """Categories and bundles live in the marketplace, not in the LAWOSS app."""
        meta = json.loads((ROOT / "lawoss-catalog.json").read_text(encoding="utf-8"))
        bundles = {bundle["id"]: bundle for bundle in meta["bundles"]}
        self.assertEqual(bundles["sk-zaklad"]["plugins"], ["slovlex", "orsr", "judikaty", "kalkulacky", "ruz", "rpo"])
        self.assertEqual(bundles["cz-zaklad"]["plugins"], ["cz-agents", "eurlex-celex"])
        self.assertTrue(bundles["cz-zaklad"]["provisional"])
        self.assertEqual(meta["plugins"]["google-workspace-gog"]["category"], "general")
        claude = json.loads(CLAUDE_CATALOG.read_text(encoding="utf-8"))
        orsr = next(plugin for plugin in claude["plugins"] if plugin["name"] == "orsr")
        self.assertEqual(orsr["tags"], ["lawoss-category:sk", "jurisdiction:sk"])

        for mutate, message in (
            (lambda meta: meta["plugins"].pop("orsr"), "must describe exactly the catalog plugins"),
            (lambda meta: meta["bundles"][0]["plugins"].append("neexistuje"), "references unknown plugins"),
            (lambda meta: meta["plugins"]["orsr"]["title"].pop("de"), "needs sk, cs, en and de"),
        ):
            with tempfile.TemporaryDirectory() as directory:
                copied_root = self._copy_repository(directory)
                path = copied_root / "lawoss-catalog.json"
                data = json.loads(path.read_text(encoding="utf-8"))
                mutate(data)
                path.write_text(json.dumps(data), encoding="utf-8")
                result = self._run_validator(copied_root)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)

    def test_denylist_exemption_rejects_changed_runtime_bytes(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('validator', ROOT / 'scripts/validate.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            copied = self._copy_repository(directory)
            path = copied / 'plugins/ru/runtime/dist/ru-client.js'
            with path.open('a') as stream:
                stream.write('\nconst leakedHost = "' + '.'.join(('10','23','45','67')) + '";\n')
            with self.assertRaisesRegex(module.ValidationFailure, 'private network address'):
                module.validate_public_tree(copied)

    def test_repository_validator_accepts_its_own_public_safe_rules(self) -> None:
        """Catch a sanitization rule that rejects its own validator source."""
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "validate.py")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
