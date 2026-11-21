import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "plugins" / "lhuty-kalkulacky-cz" / "skills" / "cz-lhuty" / "SKILL.md"

# An empty vm context has the JavaScript built-ins (Date, Set, Math) but no
# require, process or console, like the LAWOSS `execute` sandbox.
RUNNER = r"""
const vm = require("vm");
const { code, expressions } = JSON.parse(require("fs").readFileSync(0, "utf8"));
(async () => {
  const results = [];
  for (const expression of expressions) {
    const context = vm.createContext({});
    try {
      results.push({ ok: await vm.runInContext(`(async () => {\n${code}\nreturn ${expression};\n})()`, context) });
    } catch (error) {
      results.push({ error: String(error && error.message || error) });
    }
  }
  process.stdout.write(JSON.stringify(results));
})();
"""

EXPECTED = {
    'konec("2026-12-15", 15, "dny")': "2026-12-30",
    'konec("2026-04-30", 1, "dny")': "2026-05-04",
    'konec("2026-03-05", 3, "dny")': "2026-03-09",
    'konec("2026-03-31", 3, "mesice")': "2026-06-30",
    'konec("2026-03-31", 3, "mesice", "dr")': "2026-07-01",
    'konec("2026-03-02", 2, "mesice")': "2026-05-04",
    'konec(fikce("2026-04-23"), 15, "dny")': "2026-05-19",
    'konec(fikce("2026-04-21"), 15, "dny")': "2026-05-19",
    'konec("2026-11-13", 15, "dny")': "2026-11-30",
    'konec("2026-01-15", 2, "tydny")': "2026-01-29",
    'konec("2026-01-15", 2, "tydny", "dr")': "2026-01-30",
    'konec("2024-02-29", 1, "roky")': "2025-02-28",
    'konec("2026-03-30", 4, "dny")': "2026-04-07",
    'konec("2015-03-31", 3, "dny")': "2015-04-03",
    'konec("2026-12-20", 2, "mesice", "dr")': "2027-02-22",
    'konec("2026-12-31", 2, "mesice")': "2027-03-01",
    'cesky(konec("2026-11-13", 15, "dny"))': "pondělí 30. 11. 2026",
}

REJECTED = [
    'konec("2026-02-30", 15, "dny")',
    'konec("13. 11. 2026", 15, "dny")',
    'konec("2026-11-13", 15, "hodiny")',
    'konec("2026-11-13", 15, "dny", "trs")',
    'konec("2026-11-13", -1, "dny")',
]


def skill_javascript() -> str:
    blocks = re.findall(r"^```js\n(.*?)^```", SKILL.read_text(encoding="utf-8"), re.S | re.M)
    if len(blocks) != 1:
        raise AssertionError(f"cz-lhuty SKILL.md must contain exactly one ```js block, found {len(blocks)}")
    return blocks[0]


def run_in_sandbox(code: str, expressions: list[str]) -> list[dict]:
    completed = subprocess.run(
        ["node", "-e", RUNNER],
        input=json.dumps({"code": code, "expressions": expressions}),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(completed.stdout)


@unittest.skipUnless(shutil.which("node"), "node is required to run the skill's JavaScript")
class CzLhutyJavaScriptTest(unittest.TestCase):
    def test_control_cases_match_in_an_execute_like_sandbox(self) -> None:
        expressions = list(EXPECTED)
        for expression, result in zip(expressions, run_in_sandbox(skill_javascript(), expressions)):
            with self.subTest(expression=expression):
                self.assertEqual(result, {"ok": EXPECTED[expression]})

    def test_skill_self_check_passes_and_covers_every_documented_case(self) -> None:
        [result] = run_in_sandbox(skill_javascript(), ["kontrola()"])
        self.assertEqual(result, {"ok": "9 kontrolních případů v pořádku"})

    def test_documented_table_matches_the_code(self) -> None:
        rows = re.findall(r"^\| `([^`]+)` \| (\d{1,2})\. (\d{1,2})\. (\d{4})", SKILL.read_text(encoding="utf-8"), re.M)
        self.assertEqual(len(rows), 9)
        expressions = [row[0] for row in rows]
        for (expression, day, month, year), result in zip(rows, run_in_sandbox(skill_javascript(), expressions)):
            with self.subTest(expression=expression):
                self.assertEqual(result, {"ok": f"{year}-{int(month):02d}-{int(day):02d}"})

    def test_invalid_input_throws_instead_of_returning_a_date(self) -> None:
        for expression, result in zip(REJECTED, run_in_sandbox(skill_javascript(), REJECTED)):
            with self.subTest(expression=expression):
                self.assertIn("error", result)


if __name__ == "__main__":
    unittest.main()
