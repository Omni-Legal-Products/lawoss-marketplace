#!/usr/bin/env python3
"""Generate plugins/lawoss-remote-skills: remote editions of the local usage skills.

Each usage skill of the version 1 runtime plugins is copied to
plugins/lawoss-remote-skills/skills/<name>-remote/SKILL.md for users of a self-hosted
LAWOSS server. The generator renames the skill, removes the sections that only apply to
the bundled local runtime (anything that runs the local CLI) and appends a Slovak
"Vzdialený režim" section built from scripts/remote_skills_policy.json, a copy of the
hub tool policy of lawoss-selfhost. The local plugins are only read, never written.

Usage: python3 scripts/build_remote_skills.py [--check]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = ROOT / "scripts" / "remote_skills_policy.json"
REMOTE_PLUGIN = "lawoss-remote-skills"
OUTPUT = ROOT / "plugins" / REMOTE_PLUGIN / "skills"
SUFFIX = "-remote"

# User-visible refusals of the hub (lawoss-selfhost hub/src/policy.ts at the policy commit).
DENY_TEXT = "Tento nástroj je dostupný len v lokálnom plugine."
SAVE_REFUSAL_TEXT = "Ukladanie súborov na server nie je dostupné; výsledok dostanete v odpovedi."

CLI_MARKER = "scripts/run.mjs"
# Catalog boilerplate about the bundled runtime; removed only when its text is exactly this.
INSTALL_HEADING = "## Inštalácia v LAWOSS"
INSTALL_BODY = (
    "Pribalený lokálny runtime a CLI vyžadujú Node.js 22.14+ a npm. Prvý štart nainštaluje "
    "uzamknuté závislosti; ďalšie štarty použijú vyrovnávaciu pamäť. Podrobnosti a obmedzenia "
    "sú v README pluginu."
)
DESCRIPTION_PREFIX = "Vzdialená verzia pre self-hosted server LAWOSS. "
MAX_DESCRIPTION = 1024

# What to do instead of each remote-denied tool. Every denied tool needs an entry, and every
# tool named here must be offered remotely, so a policy refresh cannot leave stale advice.
ALTERNATIVES = {
    "crz": {
        "crz_download_attachment": "text podporovanej prílohy (PDF, DOCX, UTF-8 TXT) načítaj cez "
        "`crz_contract_to_markdown`; samotný súbor prílohy stiahne len lokálny plugin.",
    },
    "eurlex": {
        "eurlex_document_export": "znenie čítaj po oknách cez `eurlex_document_get` (`offset_chars`, "
        "`max_chars`); súbor exportu (PDF, Formex) vytvorí len lokálny plugin.",
    },
    "judikaty": {
        "download_decision_document": "text rozhodnutia čítaj po oknách cez `get_decision_markdown` alebo "
        "`get_decision_markdown_by_reference`; pôvodný dokument stiahne len lokálny plugin.",
        "export_decision_markdown": "dlhý text čítaj po oknách cez `get_decision_markdown`.",
        "export_decision_markdown_by_reference": "dlhý text čítaj po oknách cez "
        "`get_decision_markdown_by_reference`.",
        "manage_watchlist": "sledovanie vecí potrebuje uložený stav, preto je len v lokálnom plugine.",
    },
    "ruz": {
        "ruz_download_attachment": "čísla zo závierky čítaj cez `ruz_get_report`; originál PDF (aj pri "
        "`structuredDataAvailable: false`) stiahne len lokálny plugin.",
    },
    "slovlex": {
        "read_saved_markdown": "server nič neukladá, takže nie je čo spätne čítať; text si vyžiadaj "
        "znova cez `get_version` alebo `get_explanatory_report_text`.",
        "save_explanatory_report_markdown": "dôvodovú správu čítaj cez `get_explanatory_report_text`.",
        "save_law_markdown": "celé znenie vrátane príloh čítaj cez `get_version` po oknách, kým nepríde "
        "`MCP_WINDOW_COMPLETE: true`.",
    },
}
BACKTICKED = re.compile(r"`([^`]+)`")


class GenerationError(RuntimeError):
    """A source skill or the policy no longer has the shape the generator relies on."""


def fail(message: str) -> None:
    raise GenerationError(message)


def load_policy() -> dict:
    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    services = policy.get("services")
    if not isinstance(services, dict) or not services:
        fail("remote_skills_policy.json has no services")
    plugins = [entry.get("plugin") for entry in services.values()]
    if len(plugins) != len(set(plugins)):
        fail("remote_skills_policy.json maps two services to one plugin")
    for service, entry in services.items():
        offered = set(entry["allow"]) | set(entry["allowWithout"])
        denied = set(entry["denyRemote"])
        if offered & denied:
            fail(f"{service}: a tool is both offered and denied")
        advice = ALTERNATIVES.get(service, {})
        if set(advice) != denied:
            fail(f"{service}: alternatives must cover exactly the denied tools {sorted(denied)}, got {sorted(advice)}")
        for tool, text in advice.items():
            named = [token for token in BACKTICKED.findall(text) if token in offered | denied]
            if set(named) & denied:
                fail(f"{service}: the alternative for {tool} names a tool that is denied remotely")
            if not named and "lokálnom plugine" not in text:
                fail(f"{service}: the alternative for {tool} names no remote tool and no local plugin")
    unknown = set(ALTERNATIVES) - set(services)
    if unknown:
        fail(f"alternatives for unknown services: {sorted(unknown)}")
    return policy


def split_frontmatter(text: str, where: str) -> tuple[list[str], str]:
    if not text.startswith("---\n"):
        fail(f"{where}: frontmatter is missing")
    end = text.find("\n---\n", 4)
    if end < 0:
        fail(f"{where}: frontmatter is not closed")
    return text[4:end].split("\n"), text[end + len("\n---\n"):]


def plain_scalar_ok(value: str) -> bool:
    return bool(value) and ": " not in value and " #" not in value and not value.endswith(":") \
        and value[0] not in "!&*[]{}|>'\"%@`#,?:-"


def remote_frontmatter(lines: list[str], name: str, where: str) -> str:
    result, index, seen = [], 0, set()
    while index < len(lines):
        line = lines[index]
        key = line.split(":", 1)[0] if re.match(r"^[A-Za-z_][\w-]*:", line) else None
        if key is None:
            fail(f"{where}: unexpected frontmatter line {line!r}")
        seen.add(key)
        value = line.split(":", 1)[1].strip()
        index += 1
        if key == "name":
            if value != name:
                fail(f"{where}: frontmatter name {value!r} differs from the directory {name!r}")
            result.append(f"name: {name}{SUFFIX}")
        elif key == "description":
            if value in {">-", ">"}:
                folded = []
                while index < len(lines) and lines[index].startswith("  "):
                    folded.append(lines[index].strip())
                    index += 1
                value = " ".join(folded)
            elif value[:1] in {"|", ">", "'", '"'}:
                fail(f"{where}: unsupported description style {value[:2]!r}")
            description = DESCRIPTION_PREFIX + value
            if not plain_scalar_ok(value) or len(description) > MAX_DESCRIPTION:
                fail(f"{where}: description cannot be written as a plain scalar within {MAX_DESCRIPTION} characters")
            result.append(f"description: {description}")
        else:
            if value in {"", "|", ">", "|-", ">-"}:
                fail(f"{where}: unsupported block value for {key}")
            result.append(line)
    if not {"name", "description"} <= seen:
        fail(f"{where}: name and description are required")
    return "---\n" + "\n".join(result) + "\n---\n"


def split_sections(body: str) -> tuple[str, list[tuple[str, str]]]:
    """Preamble and (heading, text) H2 sections; headings inside code fences do not count."""
    preamble, sections, fenced = [], [], False
    for line in body.split("\n"):
        if line.lstrip().startswith("```"):
            fenced = not fenced
        if not fenced and line.startswith("## "):
            sections.append((line, [line]))
        elif sections:
            sections[-1][1].append(line)
        else:
            preamble.append(line)
    if fenced:
        fail("unterminated code fence")
    return "\n".join(preamble), [(heading, "\n".join(lines)) for heading, lines in sections]


def scrub(body: str, where: str, catalog_install: bool) -> tuple[str, list[str]]:
    """Remove local-runtime sections; return the body and the removed headings."""
    preamble, sections = split_sections(body)
    if CLI_MARKER in preamble:
        fail(f"{where}: the local CLI is mentioned before the first section; cannot remove it safely")
    kept, removed = [preamble.rstrip("\n")], []
    for heading, text in sections:
        content = text[len(heading):].strip()
        if CLI_MARKER in text:
            removed.append(heading[3:])
        elif catalog_install and heading == INSTALL_HEADING:
            if content != INSTALL_BODY:
                fail(f"{where}: '{INSTALL_HEADING}' changed; review whether it still only describes the local runtime")
            removed.append(heading[3:])
        else:
            kept.append(text.rstrip("\n"))
    result = "\n\n".join(part for part in kept if part.strip()) + "\n"
    if "run.mjs" in result:
        fail(f"{where}: a local CLI mention survived scrubbing")
    return result, removed


def bullet_list(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items)


def remote_section(service: str, entry: dict) -> str:
    plugin = entry["plugin"]
    denied = entry["denyRemote"]
    restricted = entry["allowWithout"]
    parts = [
        "## Vzdialený režim",
        "Táto verzia skillu je pre pripojenie na self-hosted server LAWOSS. Nástroje bežia na "
        "serveri, nie na tvojom počítači: nič lokálne neinštaluj a nepoužívaj lokálne CLI. "
        "Pripojenie a prihlásenie spravuje server, takže pokyny vyššie o lokálnom `stdio`, "
        "inštalácii alebo vlastnom nasadení sa na toto pripojenie nevzťahujú. Ak sa postup "
        "vyššie líši od tejto časti, platí táto časť.",
    ]
    if denied:
        advice = ALTERNATIVES[service]
        parts.append("Tieto nástroje server neponúka; namiesto nich postupuj takto:")
        parts.append(bullet_list([f"`{tool}` — {advice[tool]}" for tool in denied]))
    else:
        parts.append("Server ponúka všetky nástroje, ktoré tento skill spomína; žiadny z nich nie je "
                     "vyhradený lokálnemu pluginu.")
    if restricted:
        parts.append("Tieto nástroje sú dostupné bez argumentov, ktoré ukladajú súbory na server:")
        parts.append(bullet_list([
            f"`{tool}` bez " + " a ".join(f"`{argument}`" for argument in arguments)
            for tool, arguments in restricted.items()
        ]))
        parts.append("Server tieto argumenty v schéme nástroja neuvádza. Ak ich predsa pošleš, "
                     f"volanie odmietne s textom „{SAVE_REFUSAL_TEXT}“ Vynechaj ich a výsledok "
                     "čítaj priamo z odpovede.")
    instead = "použi náhradu uvedenú vyššie" if denied else "pokračuj dostupnými nástrojmi"
    parts.append(
        "Nástroj, ktorý server vyhradil lokálnemu pluginu alebo ho ešte nepreveril, v zozname "
        f"nástrojov nevidíš a jeho volanie vráti chybu „{DENY_TEXT}“ Nie je to prázdny výsledok "
        f"ani výpadok zdroja. Volanie neopakuj a {instead}. Ak používateľ potrebuje súbor na "
        f"disku alebo uložený stav, odporuč mu lokálny plugin `{plugin}` z katalógu LAWOSS."
    )
    return "\n\n".join(parts) + "\n"


def generate() -> tuple[dict[str, bytes], list[dict]]:
    """All generated files as {path relative to OUTPUT: bytes}, plus a per-skill summary."""
    policy = load_policy()
    files: dict[str, bytes] = {}
    summary = []
    for service in sorted(policy["services"]):
        entry = policy["services"][service]
        skills_dir = ROOT / "plugins" / entry["plugin"] / "skills"
        sources = sorted(path.parent for path in skills_dir.glob("*/SKILL.md"))
        if not sources:
            fail(f"{service}: plugin {entry['plugin']} has no usage skill")
        for source in sources:
            name = source.name
            where = f"plugins/{entry['plugin']}/skills/{name}"
            target = f"{name}{SUFFIX}"
            if f"{target}/SKILL.md" in files:
                fail(f"{where}: duplicate remote skill name {target}")
            lines, body = split_frontmatter((source / "SKILL.md").read_text(encoding="utf-8"), where)
            scrubbed, removed = scrub(body, where, catalog_install=True)
            text = remote_frontmatter(lines, name, where) + scrubbed + "\n" + remote_section(service, entry)
            if "run.mjs" in text:
                fail(f"{where}: generated text mentions the local CLI")
            files[f"{target}/SKILL.md"] = text.encode("utf-8")
            for path in sorted(p for p in source.rglob("*") if p.is_file() and p.name != "SKILL.md"):
                relative = path.relative_to(source).as_posix()
                if not (relative.startswith("references/") and path.suffix == ".md"):
                    fail(f"{where}: unsupported skill file {relative}; only references/*.md are copied")
                reference, _ = scrub(path.read_text(encoding="utf-8"), f"{where}/{relative}", catalog_install=False)
                files[f"{target}/{relative}"] = reference.encode("utf-8")
            summary.append({"service": service, "plugin": entry["plugin"], "skill": target,
                            "removed": removed, "denied": list(entry["denyRemote"]),
                            "allowWithout": dict(entry["allowWithout"])})
    return files, summary


def existing_files() -> dict[str, bytes]:
    if not OUTPUT.exists():
        return {}
    return {path.relative_to(OUTPUT).as_posix(): path.read_bytes() for path in OUTPUT.rglob("*") if path.is_file()}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="exit 1 when the committed output differs")
    parser.add_argument("--summary", action="store_true", help="print the per-skill summary as JSON")
    args = parser.parse_args(argv)
    try:
        files, summary = generate()
    except GenerationError as error:
        print(f"build_remote_skills: {error}", file=sys.stderr)
        return 2
    current = existing_files()
    if args.check:
        problems = [f"missing: {path}" for path in sorted(set(files) - set(current))]
        problems += [f"stale: {path}" for path in sorted(set(current) - set(files))]
        problems += [f"differs: {path}" for path in sorted(set(files) & set(current)) if files[path] != current[path]]
        for problem in problems:
            print(problem, file=sys.stderr)
        if problems:
            print("Run python3 scripts/build_remote_skills.py and commit the result.", file=sys.stderr)
            return 1
    else:
        for path in sorted(set(current) - set(files)):
            (OUTPUT / path).unlink()
        for directory in sorted((p for p in OUTPUT.rglob("*") if p.is_dir()), reverse=True) if OUTPUT.exists() else []:
            if not any(directory.iterdir()):
                directory.rmdir()
        for path, data in sorted(files.items()):
            target = OUTPUT / path
            target.parent.mkdir(parents=True, exist_ok=True)
            if current.get(path) != data:
                target.write_bytes(data)
    if args.summary:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
    elif not args.check:
        print(f"wrote {len(files)} files under plugins/{REMOTE_PLUGIN}/skills")
    return 0


if __name__ == "__main__":
    sys.exit(main())
