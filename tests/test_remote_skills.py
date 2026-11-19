"""Remote editions of the usage skills in plugins/lawoss-remote-skills (generated)."""

import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
POLICY = json.loads((ROOT / "scripts" / "remote_skills_policy.json").read_text(encoding="utf-8"))
REMOTE_PLUGIN = "lawoss-remote-skills"
REMOTE_SKILLS = ROOT / "plugins" / REMOTE_PLUGIN / "skills"
DENY_TEXT = "Tento nástroj je dostupný len v lokálnom plugine."
REMOTE_HEADING = "## Vzdialený režim"
NOTICE_PREFIX = "> **Vzdialený režim:**"
# Local setup sections that a remote edition must not carry.
LOCAL_SETUP_HEADINGS = {"## Lokálny plugin", "## Autorizácia", "## Inštalácia", "## Autentifikácia",
                        "## Pripojenie a autorizácia", "## Transport", "## Inštalácia v LAWOSS"}


def source_skills(plugin: str) -> list[str]:
    return sorted(path.parent.name for path in (ROOT / "plugins" / plugin / "skills").glob("*/SKILL.md"))


def remote_section(text: str) -> str:
    """The text of the appended remote-mode section, up to the next H2 heading."""
    start = text.index(REMOTE_HEADING + "\n")
    rest = text[start + len(REMOTE_HEADING):]
    following = re.search(r"^## ", rest, flags=re.MULTILINE)
    return rest[: following.start()] if following else rest


class RemoteSkillsTest(unittest.TestCase):
    def test_remote_skills_exist_for_every_version_1_service(self) -> None:
        self.assertEqual(len(POLICY["services"]), 14)
        for service, entry in POLICY["services"].items():
            names = source_skills(entry["plugin"])
            self.assertTrue(names, f"{service}: plugin {entry['plugin']} has no usage skill")
            for name in names:
                skill = REMOTE_SKILLS / f"{name}-remote" / "SKILL.md"
                self.assertTrue(skill.is_file(), f"{service}: {skill.relative_to(ROOT)} is missing")
                text = skill.read_text(encoding="utf-8")
                self.assertTrue(text.startswith(f"---\nname: {name}-remote\n"), f"{name}: frontmatter name")
                self.assertIn("self-hosted", text.split("\n---\n", 1)[0], f"{name}: description must name the self-hosted server")
                self.assertIn(REMOTE_HEADING + "\n", text, f"{name}: remote-mode section is missing")

    def test_remote_skill_text_contains_no_scripts_run_mjs(self) -> None:
        files = sorted(path for path in REMOTE_SKILLS.rglob("*") if path.is_file())
        self.assertTrue(files, "no generated remote skill files")
        for path in files:
            self.assertNotIn("run.mjs", path.read_text(encoding="utf-8"), str(path.relative_to(ROOT)))

    def test_remote_skill_names_every_denied_tool_of_its_service(self) -> None:
        for service, entry in POLICY["services"].items():
            for name in source_skills(entry["plugin"]):
                section = remote_section((REMOTE_SKILLS / f"{name}-remote" / "SKILL.md").read_text(encoding="utf-8"))
                self.assertIn(DENY_TEXT, section, f"{name}: the user-visible denial text is missing")
                for tool in entry["denyRemote"]:
                    self.assertIn(f"`{tool}`", section, f"{name}: denied tool {tool} is not named")
                for tool, arguments in entry["allowWithout"].items():
                    self.assertIn(f"`{tool}`", section, f"{name}: restricted tool {tool} is not named")
                    for argument in arguments:
                        self.assertIn(f"`{argument}`", section, f"{name}: removed argument {argument} of {tool} is not named")

    def test_generated_output_is_up_to_date(self) -> None:
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "build_remote_skills.py"), "--check"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_local_skills_are_unchanged(self) -> None:
        """Running the generator changes nothing outside plugins/lawoss-remote-skills."""
        def snapshot(root: Path) -> dict[str, bytes]:
            return {path.relative_to(root).as_posix(): path.read_bytes()
                    for path in root.rglob("*") if path.is_file()}

        with tempfile.TemporaryDirectory() as directory:
            copy = Path(directory) / "marketplace"
            shutil.copytree(ROOT, copy, ignore=shutil.ignore_patterns(".git", "__pycache__"))
            shutil.rmtree(copy / "plugins" / REMOTE_PLUGIN / "skills")
            before = snapshot(copy)
            result = subprocess.run([sys.executable, str(copy / "scripts" / "build_remote_skills.py")],
                                    cwd=copy, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            after = snapshot(copy)
        changed = {path for path in set(before) | set(after) if before.get(path) != after.get(path)}
        self.assertTrue(changed, "the generator wrote nothing")
        outside = sorted(path for path in changed if not path.startswith(f"plugins/{REMOTE_PLUGIN}/"))
        self.assertEqual(outside, [])

    def test_denied_tools_appear_only_in_the_notice_and_remote_section(self) -> None:
        for service, entry in POLICY["services"].items():
            for name in source_skills(entry["plugin"]):
                text = (REMOTE_SKILLS / f"{name}-remote" / "SKILL.md").read_text(encoding="utf-8")
                body = text.split("\n---\n", 1)[1]
                lines = body.split("\n")
                heading = next(index for index, line in enumerate(lines) if line.startswith("# "))
                self.assertEqual(lines[heading + 1], "", f"{name}: blank line after the H1")
                self.assertTrue(lines[heading + 2].startswith(NOTICE_PREFIX), f"{name}: notice must sit right under the H1")
                notice = lines[heading + 2]
                rest = "\n".join(lines[:heading + 2] + lines[heading + 3:])
                rest = rest[: rest.index(REMOTE_HEADING + "\n")]
                for tool in entry["denyRemote"]:
                    self.assertIn(f"`{tool}`", notice, f"{name}: notice must name {tool}")
                    self.assertIsNone(re.search(rf"\b{tool}\b", rest), f"{name}: body still mentions denied {tool}")

    def test_remote_skills_carry_no_local_setup_sections(self) -> None:
        for path in sorted(REMOTE_SKILLS.glob("*/SKILL.md")):
            text = path.read_text(encoding="utf-8")
            headings = {line for line in text.split("\n") if line.startswith("## ")}
            self.assertFalse(headings & LOCAL_SETUP_HEADINGS, f"{path.parent.name}: {sorted(headings & LOCAL_SETUP_HEADINGS)}")
            for fragment in ("FS_API_KEY", "/data/oauth-state.json", "node dist/server.js", "MCP_ALLOW_ANONYMOUS",
                             "Lokálne MCP beží cez", "Lokálny stdio režim"):
                self.assertNotIn(fragment, text, f"{path.parent.name}: {fragment}")


if __name__ == "__main__":
    unittest.main()
