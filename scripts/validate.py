#!/usr/bin/env python3
"""Validate the LAWOSS catalogs and their public-safe local wrappers."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
CODEX_CATALOG = ROOT / ".agents" / "plugins" / "marketplace.json"
CLAUDE_CATALOG = ROOT / ".claude-plugin" / "marketplace.json"
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
URL = re.compile(r"https?://[^\s`\]\[(){}<>\"']+")
ALLOWED_PUBLIC_HOSTS = {"github.com", "mcp.example.com", "www.crz.gov.sk"}
MACOS_USER_PATH = re.compile("/" + r"Users/[^/\s]+/")
WINDOWS_USER_PATH = re.compile(r"[A-Za-z]:\\" + r"Users\\[^\\\s]+\\")
SECRET_SIGNATURES = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bAKIA[A-Z0-9]{16}\b"),
)


class ValidationFailure(RuntimeError):
    """Raised when a distributable marketplace invariant is broken."""


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValidationFailure(f"missing required JSON file: {path.relative_to(ROOT)}") from exc
    except json.JSONDecodeError as exc:
        raise ValidationFailure(f"invalid JSON in {path.relative_to(ROOT)}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValidationFailure(f"expected JSON object in {path.relative_to(ROOT)}")
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationFailure(message)


def validate_plugin(entry: dict, plugin_root: Path) -> None:
    manifest_path = plugin_root / ".codex-plugin" / "plugin.json"
    manifest = load_json(manifest_path)
    require(manifest.get("name") == entry["name"], "plugin manifest name must match its catalog entry")
    require(manifest.get("name") == plugin_root.name, "plugin manifest name must match its directory")
    require(isinstance(manifest.get("version"), str) and bool(SEMVER.fullmatch(manifest["version"])), "plugin version must be strict semver")
    require(manifest.get("skills") == "./skills/", "CRZ wrapper must declare its skills directory")
    require(manifest.get("author", {}).get("name") == "LAWOSS", "plugin author must be LAWOSS")
    require("mcpServers" not in manifest, "skill-only wrapper must not declare mcpServers")
    require(not (plugin_root / ".mcp.json").exists(), "skill-only wrapper must not contain .mcp.json")

    skill_path = plugin_root / "skills" / "crz-register-zmluv" / "SKILL.md"
    require(skill_path.is_file(), "CRZ usage skill is missing")
    require(
        skill_path.read_text(encoding="utf-8").startswith("---\nname: crz-register-zmluv\n"),
        "CRZ skill frontmatter name is missing or malformed",
    )


def validate_catalogs() -> int:
    codex = load_json(CODEX_CATALOG)
    claude = load_json(CLAUDE_CATALOG)
    require(codex == claude, "Codex and Claude catalogs must be semantically aligned")
    require(codex.get("name") == "lawoss", "canonical marketplace name must be lawoss")
    require(codex.get("interface") == {"displayName": "LAWOSS Marketplace"}, "marketplace display name must be LAWOSS Marketplace")

    plugins = codex.get("plugins")
    require(isinstance(plugins, list), "catalog plugins must be an array")
    require([entry.get("name") for entry in plugins] == ["crz"], "only the approved CRZ wrapper may be installable")

    root = ROOT.resolve()
    for entry in plugins:
        require(isinstance(entry, dict), "every catalog entry must be an object")
        source = entry.get("source")
        require(isinstance(source, dict), "plugin source must be an object")
        require(source.get("source") == "local", "plugin source must be local")
        source_path = source.get("path")
        require(isinstance(source_path, str) and source_path.startswith("./plugins/"), "plugin source.path must begin with ./plugins/")
        require(
            entry.get("policy") == {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
            "plugin policy must be AVAILABLE with ON_INSTALL authentication",
        )
        require(entry.get("category") == "Productivity", "plugin catalog category must be Productivity")

        plugin_root = (ROOT / source_path).resolve()
        try:
            plugin_root.relative_to(root)
        except ValueError as exc:
            raise ValidationFailure(f"plugin source escapes marketplace root: {source_path}") from exc
        require(plugin_root.is_dir(), f"plugin source directory is missing: {source_path}")
        validate_plugin(entry, plugin_root)

    return len(plugins)


def validate_public_tree() -> None:
    for path in ROOT.rglob("*"):
        if not path.is_file() or ".git" in path.parts or "__pycache__" in path.parts:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue

        relative = path.relative_to(ROOT)
        require(not any(pattern.search(text) for pattern in SECRET_SIGNATURES), f"secret signature found in {relative}")
        require(not MACOS_USER_PATH.search(text), f"user-specific macOS path found in {relative}")
        require(not WINDOWS_USER_PATH.search(text), f"user-specific Windows path found in {relative}")

        for match in URL.finditer(text):
            hostname = (urlparse(match.group(0)).hostname or "").lower()
            require(hostname in ALLOWED_PUBLIC_HOSTS, f"unapproved URL hostname in {relative}")


def main() -> int:
    try:
        count = validate_catalogs()
        validate_public_tree()
    except ValidationFailure as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        return 1

    print(f"Validated 2 aligned LAWOSS catalogs and {count} public-safe plugin wrapper.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
