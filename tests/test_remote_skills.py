"""Remote editions of the usage skills in plugins/lawoss-remote-skills (generated)."""

import hashlib
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
POLICY = json.loads((ROOT / "scripts" / "remote_skills_policy.json").read_text(encoding="utf-8"))
REMOTE_PLUGIN = "lawoss-remote-skills"
REMOTE_SKILLS = ROOT / "plugins" / REMOTE_PLUGIN / "skills"
DENY_TEXT = "Tento nástroj je dostupný len v lokálnom plugine."
REMOTE_HEADING = "## Vzdialený režim"


def source_skills(plugin: str) -> list[str]:
    return sorted(path.parent.name for path in (ROOT / "plugins" / plugin / "skills").glob("*/SKILL.md"))


def remote_section(text: str) -> str:
    """The text of the appended remote-mode section, up to the next H2 heading."""
    start = text.index(REMOTE_HEADING + "\n")
    rest = text[start + len(REMOTE_HEADING):]
    following = re.search(r"^## ", rest, flags=re.MULTILINE)
    return rest[: following.start()] if following else rest


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def blob_id(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


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
        """The remote editions never touch the local plugins' skills (compared with main)."""
        base = None
        for ref in ("origin/main", "main"):
            try:
                base = git("merge-base", "HEAD", ref).strip()
                break
            except (subprocess.CalledProcessError, FileNotFoundError):
                continue
        if not base:
            self.skipTest("no main branch in this checkout (shallow clone); cannot compare local skills")
        skill_path = re.compile(r"plugins/([^/]+)/skills/")

        def local(path: str) -> bool:
            match = skill_path.match(path)
            return bool(match) and match.group(1) != REMOTE_PLUGIN

        expected = {}
        for line in git("ls-tree", "-r", base, "--", "plugins").splitlines():
            meta, path = line.split("\t", 1)
            if local(path):
                expected[path] = meta.split()[2]
        actual = {}
        for path in (ROOT / "plugins").glob("*/skills/**/*"):
            relative = path.relative_to(ROOT).as_posix()
            if path.is_file() and local(relative):
                actual[relative] = blob_id(path.read_bytes())
        self.assertTrue(expected, "main has no local skills")
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
