import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CODEX_CATALOG = ROOT / ".agents" / "plugins" / "marketplace.json"
CLAUDE_CATALOG = ROOT / ".claude-plugin" / "marketplace.json"


class MarketplaceValidationTest(unittest.TestCase):
    def test_catalogs_publish_only_safe_contained_wrappers(self) -> None:
        """Catch path escape, metadata drift, or automatic MCP registration."""
        codex = json.loads(CODEX_CATALOG.read_text(encoding="utf-8"))
        claude = json.loads(CLAUDE_CATALOG.read_text(encoding="utf-8"))

        self.assertEqual(codex, claude)
        self.assertEqual(codex["name"], "lawoss")
        self.assertEqual(codex["interface"], {"displayName": "LAWOSS Marketplace"})
        self.assertEqual([plugin["name"] for plugin in codex["plugins"]], ["crz"])

        for plugin in codex["plugins"]:
            source = plugin["source"]
            self.assertEqual(source["source"], "local")
            self.assertTrue(source["path"].startswith("./plugins/"))
            self.assertEqual(
                plugin["policy"],
                {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
            )
            self.assertEqual(plugin["category"], "Productivity")

            plugin_root = (ROOT / source["path"]).resolve()
            plugin_root.relative_to(ROOT.resolve())
            manifest_path = plugin_root / ".codex-plugin" / "plugin.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["name"], plugin["name"])
            self.assertNotIn("mcpServers", manifest)
            self.assertFalse(
                (plugin_root / ".mcp.json").exists(),
                "A skill-only marketplace wrapper must not auto-register an MCP server",
            )

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
