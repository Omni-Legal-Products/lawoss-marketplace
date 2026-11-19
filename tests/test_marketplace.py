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
SELFHOST = ROOT / "plugins" / "lawoss-selfhost"
SELFHOST_SKILL_DIR = SELFHOST / "skills" / "lawoss-selfhost"
# The 15 steps of design section 5.6, in Slovak and in order.
SELFHOST_STEPS = (
    "Čo sa nainštaluje, čo to stojí a čo nerobí",
    "Server, doména, služby a značka",
    "Pripojenie na server",
    "Firewall",
    "DNS",
    "Stiahnutie pripnutého vydania",
    "Generovanie tajomstiev",
    "Značka",
    "Certifikáty",
    "Spustenie",
    "Prvý účet",
    "Pripojenie aplikácie",
    "Overenie",
    "Zálohy",
    "Odovzdanie",
)
# Commands that print secrets. The skill lists them as never to be run and runs none of them itself.
SECRET_COMMANDS = ("cat .env", "docker compose config", "env", "printenv", "docker inspect", "set -x", "docker compose logs", "docker logs")
SECRET_COMMAND_LINE = re.compile(
    r"^(?:sudo\s+)?(?:env|printenv)(?:\s|$)"
    r"|\bdocker compose\b[^\n]*\b(?:config|logs)\b|\bdocker (?:inspect|logs)\b|set -x|bash -x"
    r"|\b(?:cat|less|more|head|tail|grep|sed|awk|cp|scp|install)\b[^\n]*(?:\.env\b|/keys/|/snapshots/|/handoff/|backup-private\.pem)"
    # The certificate store of an existing reverse proxy holds private keys.
    r"|acme\.json"
)
# The one permitted inspect of the existing proxy's container: network names and gateways only.
NETWORK_ONLY_INSPECT = re.compile(
    r"(?:sudo\s+)?docker inspect <?[\w.-]+>? --format "
    r"'\{\{range \$(\w+), \$(\w+) := \.NetworkSettings\.Networks\}\}\{\{\$\1\}\} \{\{\$\2\.Gateway\}\}\{\{println\}\}\{\{end\}\}'"
)
# Agent commands are `sh` blocks; commands the human types in their own terminal are `text` blocks.
# Fences may be indented (inside list items).
FENCED_BLOCK = re.compile(r"^[ \t]*```([a-z]*)\n(.*?)^[ \t]*```", re.M | re.S)
# Steps that handle secrets repeat the secret rule.
SELFHOST_SECRET_STEPS = (7, 10, 11, 14)


def secret_command_lines(text: str) -> list[str]:
    """Agent (`sh`) lines that would print or copy a secret."""
    return [line.strip() for language, block in FENCED_BLOCK.findall(text) if language == "sh"
            for line in block.splitlines()
            if SECRET_COMMAND_LINE.search(line.strip()) and not NETWORK_ONLY_INSPECT.fullmatch(line.strip())]


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
        self.assertEqual(len(codex["plugins"]), 23)
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
        self.assertEqual(bundles["cz-zaklad"]["plugins"], ["esbirka", "judikatura-cz", "lhuty-kalkulacky-cz", "katastr-cz", "cz-agents", "eurlex-celex"])
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

    def test_policy_names_selfhost_and_no_lawoss_hosting(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("LAWOSS does not host or operate", readme)
        self.assertIn("lawoss-selfhost", readme)
        runtime_doc = (ROOT / "docs" / "local-runtime.md").read_text(encoding="utf-8")
        self.assertIn("lawoss-selfhost", runtime_doc)
        model = (ROOT / "docs" / "distribution-model.html").read_text(encoding="utf-8")
        self.assertIn("lawoss-selfhost", model)
        for path in (ROOT / "docs").rglob("*"):
            if path.is_file() and path.suffix in {".md", ".html"}:
                self.assertNotIn(
                    "No hosted transport is permitted",
                    path.read_text(encoding="utf-8"),
                    msg=str(path),
                )
        for name in ("README.md", "AGENTS.md", "CLAUDE.md"):
            self.assertNotIn(
                "No hosted transport is permitted",
                (ROOT / name).read_text(encoding="utf-8"),
                msg=name,
            )

    def _selfhost_record(self, ledger: dict) -> dict:
        return next(record for record in ledger["releases"] if record["name"] == "lawoss-selfhost")

    def _selfhost_skill_texts(self) -> dict:
        return {path.relative_to(SELFHOST_SKILL_DIR).as_posix(): path.read_text(encoding="utf-8") for path in sorted(SELFHOST_SKILL_DIR.rglob("*.md"))}

    def test_selfhost_is_skill_only(self) -> None:
        """The self-hosting skill deploys a server elsewhere; it ships no MCP, runtime or scripts itself."""
        manifest = json.loads((SELFHOST / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["skills"], "./skills/")
        self.assertNotIn("mcpServers", manifest)
        for name in (".mcp.json", "runtime", "scripts"):
            self.assertFalse((SELFHOST / name).exists(), msg=name)
        record = self._selfhost_record(json.loads((ROOT / "releases.json").read_text(encoding="utf-8")))
        self.assertEqual(record["distribution"], "selfhost-skill")
        self.assertEqual(record["repository"], "Omni-Legal-Products/lawoss-selfhost")
        self.assertIn(record["commit"], (SELFHOST / "README.md").read_text(encoding="utf-8"))

        for mutation in (
            lambda root: (root / "plugins/lawoss-selfhost/.mcp.json").write_text('{"mcpServers": {}}'),
            lambda root: (root / "plugins/lawoss-selfhost/runtime").mkdir(),
            lambda root: (root / "plugins/lawoss-selfhost/scripts").mkdir(),
        ):
            with tempfile.TemporaryDirectory() as directory:
                copied_root = self._copy_repository(directory)
                mutation(copied_root)
                result = self._run_validator(copied_root)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("selfhost wrapper must be skill-only", result.stderr)

    def test_selfhost_skill_lists_all_fifteen_gates(self) -> None:
        """Every step of design 5.6 is a numbered heading with what the agent may do and what the human confirms."""
        skill = (SELFHOST_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue(skill.startswith("---\nname: lawoss-selfhost\n"))
        headings = re.findall(r"^## (\d+)\. (.+)$", skill, re.M)
        self.assertEqual(headings, [(str(number), title) for number, title in enumerate(SELFHOST_STEPS, 1)])
        sections = re.split(r"^## \d+\. .+$", skill, flags=re.M)[1:]
        for number, section in enumerate(sections, 1):
            section = section.split("\n## ", 1)[0]
            self.assertIn("**Agent smie sám:**", section, msg=f"step {number}")
            self.assertIn("**Potvrdí človek:**", section, msg=f"step {number}")
            if number in SELFHOST_SECRET_STEPS:
                self.assertIn("**Tajomstvá:**", section, msg=f"step {number}")
        record = self._selfhost_record(json.loads((ROOT / "releases.json").read_text(encoding="utf-8")))
        for pin in (record["commit"], record["recordSha256"], f"release/{record['version']}.json"):
            self.assertIn(pin, skill)
        # The standing rules of design 5.6 are stated once, before the steps.
        for rule in ("rotáci", "nedokazuje", "update", "doctor"):
            self.assertIn(rule, skill.split("## 1. ", 1)[0].lower())

    def test_selfhost_skill_forbids_secret_commands(self) -> None:
        """The never-run list names the secret-printing commands, and no command block in the skill runs one."""
        skill = (SELFHOST_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        never = skill.split("## Nikdy nespúšťaj\n", 1)[1].split("\n## ", 1)[0]
        for command in SECRET_COMMANDS:
            self.assertIn(f"`{command}`", never)
        for path in ("/opt/lawoss/.env", ".env.previous", "keys/", "handoff/", "snapshots/", "backup-private.pem"):
            self.assertIn(path, never)
        self.assertIn("rotate", never)
        # The scan itself catches indented fences and the long compose form.
        probe = "1. Krok:\n\n   ```sh\n   sudo docker compose -f /opt/lawoss/compose.yaml --env-file /opt/lawoss/.env config\n   sudo docker compose -f /opt/lawoss/compose.yaml logs auth\n   sudo cat /opt/lawoss/handoff/jnovak.link\n   ```\n"
        self.assertEqual(len(secret_command_lines(probe)), 3)
        # The existing proxy's certificate store and a full inspect of its container are refused;
        # only the inspect restricted to network names and gateways passes.
        network_only = "sudo docker inspect <traefik> --format '{{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{$net.Gateway}}{{println}}{{end}}'"
        self.assertEqual(secret_command_lines(f"```sh\n{network_only}\n```\n"), [])
        proxy_probe = (
            "```sh\n"
            "sudo cat /srv/traefik/acme.json\n"
            "sudo docker inspect <traefik>\n"
            "sudo docker inspect <traefik> --format '{{json .Config.Env}}'\n"
            "sudo docker inspect <traefik> --format '{{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{$net.Gateway}}{{println}}{{end}}{{.Config.Env}}'\n"
            "```\n"
        )
        self.assertEqual(len(secret_command_lines(proxy_probe)), 4)
        for name, text in self._selfhost_skill_texts().items():
            self.assertEqual(secret_command_lines(text), [], msg=name)
            for language, block in FENCED_BLOCK.findall(text):
                self.assertIn(language, {"sh", "text", "json", "css", "svg", "cron", "yaml"}, msg=f"{name}: untagged or unknown block")
                for line in block.splitlines():
                    # A provider key is typed at the hidden prompt, never piped or passed as an argument.
                    if "set-key" in line:
                        self.assertNotRegex(line, r"[|<]|set-key\s+\S+\s+\S", msg=f"{name}: {line}")

    def test_selfhost_skill_covers_an_existing_reverse_proxy(self) -> None:
        """A server whose ports 80 and 443 already belong to a proxy gets its own branch and reference."""
        skill = (SELFHOST_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        reference = SELFHOST_SKILL_DIR / "references" / "existing-proxy.md"
        self.assertTrue(reference.is_file())
        self.assertIn("`references/existing-proxy.md`", skill)
        for option in ("--http-port", "--https-port", "--proxy-bind"):
            self.assertIn(option, skill)
        self.assertIn("**Ak server už má reverznú proxy (Traefik, Dokploy, Coolify):**", skill)
        # The forwarding file follows the upstream Traefik example: SNI passthrough plus the port 80 route.
        text = reference.read_text(encoding="utf-8")
        yaml_blocks = [block for language, block in FENCED_BLOCK.findall(text) if language == "yaml"]
        self.assertEqual(len(yaml_blocks), 1)
        for key in ("lawoss-tls:", "lawoss-http:", "entryPoints: [websecure]", "entryPoints: [web]", "HostSNIRegexp(", "passthrough: true", "address: <HOST_ADDR>:18443", "url: http://<HOST_ADDR>:18080"):
            self.assertIn(key, yaml_blocks[0])
        # The never-run list covers the proxy's certificate store, its container and its configuration.
        never = skill.split("## Nikdy nespúšťaj\n", 1)[1].split("\n## ", 1)[0]
        for item in ("acme.json", "--format", "Traefik"):
            self.assertIn(item, never)

    def test_selfhost_release_pin_refusals(self) -> None:
        """The bundled release record must be exactly the one the ledger pins: bytes, commit and images."""
        def ledger_mutation(change):
            def mutate(root: Path) -> None:
                path = root / "releases.json"
                ledger = json.loads(path.read_text(encoding="utf-8"))
                change(self._selfhost_record(ledger))
                path.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")
            return mutate

        def record_bytes(root: Path) -> None:
            path = root / "plugins/lawoss-selfhost/skills/lawoss-selfhost/release/0.1.0.json"
            path.write_bytes(path.read_bytes() + b" ")

        def skill_pin(root: Path) -> None:
            path = root / "plugins/lawoss-selfhost/skills/lawoss-selfhost/SKILL.md"
            text = path.read_text(encoding="utf-8")
            path.write_text(text.replace("6f96cd390968ecfee44c34057b5d61705391ffa91953791cb463d286edfcedde", "0" * 64), encoding="utf-8")

        other_digest = "sha256:" + "0" * 64
        cases = (
            ("another repository", ledger_mutation(lambda r: r.update(repository="Omni-Legal-Products/mcp-selfhost")), "must pin a lawoss-selfhost release"),
            ("skill text names another record", skill_pin, "must name its pinned commit and record SHA-256"),
            ("wrong hash in the ledger", ledger_mutation(lambda r: r.update(recordSha256="0" * 64)), "does not match its pinned SHA-256"),
            ("changed record bytes", record_bytes, "does not match its pinned SHA-256"),
            ("commit mismatch", ledger_mutation(lambda r: r.update(commit="1" * 40)), "names a different commit"),
            ("auth image mismatch", ledger_mutation(lambda r: r["images"].update(auth=r["images"]["auth"].split("@")[0] + "@" + other_digest)), "names different images"),
            ("hub image mismatch", ledger_mutation(lambda r: r["images"].update(hub=r["images"]["hub"].split("@")[0] + "@" + other_digest)), "names different images"),
        )
        for name, mutate, message in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                copied_root = self._copy_repository(directory)
                mutate(copied_root)
                result = self._run_validator(copied_root)
                self.assertNotEqual(result.returncode, 0, msg=name)
                self.assertIn(message, result.stderr)

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
