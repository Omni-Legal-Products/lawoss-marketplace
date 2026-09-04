#!/usr/bin/env python3
"""Validate LAWOSS catalogs and their public-safe local wrappers."""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)
URL = re.compile(r"https?://[^\s`\]\[(){}<>\"']+")
IPV4_CANDIDATE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
HOSTNAME_CANDIDATE = re.compile(
    r"\b(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})\.)+[A-Za-z]{2,63}\b"
)
DEPLOYMENT_ID = re.compile(
    r"(?ix)(?:"
    r"(?:--|\b)(?:compose|project|application|deployment|container)Id"
    r"(?:\s+|\s*=\s*|\s*:\s*)"
    r"|[\"']?DOKPLOY_(?:PROJECT|APPLICATION|COMPOSE|DEPLOYMENT|CONTAINER)_ID[\"']?"
    r"(?:\s*=\s*|\s*:\s*)"
    r")[\"']?"
    r"(?!<|\$\{|example\b|placeholder\b)[A-Za-z0-9_-]{8,}"
)
MACOS_USER_PATH = re.compile("/" + r"Users/[^/\s]+/")
WINDOWS_USER_PATH = re.compile(r"[A-Za-z]:\\" + r"Users\\[^\\\s]+\\")
ALLOWED_PUBLIC_HOSTS = {"mcp.example.com", "www.crz.gov.sk"}
ALLOWED_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
PRIVATE_NETWORKS = tuple(
    ipaddress.ip_network(value)
    for value in (
        "10" + ".0.0.0/8",
        "172" + ".16.0.0/12",
        "192" + ".168.0.0/16",
        "100" + ".64.0.0/10",
    )
)
SECRET_SIGNATURES = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bAKIA[A-Z0-9]{16}\b"),
)


class ValidationFailure(RuntimeError):
    """Raised when a distributable marketplace invariant is broken."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationFailure(message)


def relative_label(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return path.name


def load_json(path: Path, root: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValidationFailure(
            f"missing required JSON file: {relative_label(path, root)}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise ValidationFailure(
            f"invalid JSON in {relative_label(path, root)}: {exc}"
        ) from exc
    if not isinstance(value, dict):
        raise ValidationFailure(f"expected JSON object in {relative_label(path, root)}")
    return value


def resolve_plugin_root(root: Path, source_path: str) -> Path:
    plugin_root = (root / source_path).resolve()
    try:
        plugin_root.relative_to(root.resolve())
    except ValueError as exc:
        raise ValidationFailure(
            f"plugin source escapes marketplace root: {source_path}"
        ) from exc
    require(plugin_root.is_dir(), f"plugin source directory is missing: {source_path}")
    return plugin_root


def validate_plugin(entry: dict, plugin_root: Path, root: Path) -> dict:
    manifest_path = plugin_root / ".codex-plugin" / "plugin.json"
    manifest = load_json(manifest_path, root)
    require(
        manifest.get("name") == entry["name"],
        "plugin manifest name must match its catalog entry",
    )
    require(
        manifest.get("name") == plugin_root.name,
        "plugin manifest name must match its directory",
    )
    require(
        isinstance(manifest.get("version"), str)
        and bool(SEMVER.fullmatch(manifest["version"])),
        "plugin version must be strict semver",
    )
    require(
        manifest.get("skills") == "./skills/",
        "CRZ wrapper must declare its skills directory",
    )
    require(
        manifest.get("author", {}).get("name") == "LAWOSS",
        "plugin author must be LAWOSS",
    )
    require(
        "mcpServers" not in manifest,
        "skill-only wrapper must not declare mcpServers",
    )
    require(
        not (plugin_root / ".mcp.json").exists(),
        "skill-only wrapper must not contain .mcp.json",
    )

    skill_path = plugin_root / "skills" / "crz-register-zmluv" / "SKILL.md"
    require(skill_path.is_file(), "CRZ usage skill is missing")
    require(
        skill_path.read_text(encoding="utf-8").startswith(
            "---\nname: crz-register-zmluv\n"
        ),
        "CRZ skill frontmatter name is missing or malformed",
    )
    return manifest


def validate_catalogs(root: Path) -> int:
    codex = load_json(root / ".agents" / "plugins" / "marketplace.json", root)
    claude = load_json(root / ".claude-plugin" / "marketplace.json", root)

    require(codex.get("name") == "lawoss", "canonical marketplace name must be lawoss")
    require(
        codex.get("interface") == {"displayName": "LAWOSS Marketplace"},
        "marketplace display name must be LAWOSS Marketplace",
    )
    codex_plugins = codex.get("plugins")
    require(isinstance(codex_plugins, list), "Codex catalog plugins must be an array")
    require(
        [entry.get("name") for entry in codex_plugins] == ["crz"],
        "only the approved CRZ wrapper may be installable",
    )

    codex_entry = codex_plugins[0]
    require(isinstance(codex_entry, dict), "Codex catalog entry must be an object")
    codex_source = codex_entry.get("source")
    require(isinstance(codex_source, dict), "Codex plugin source must be an object")
    require(codex_source.get("source") == "local", "Codex plugin source must be local")
    codex_path = codex_source.get("path")
    require(
        isinstance(codex_path, str) and codex_path.startswith("./plugins/"),
        "Codex plugin source.path must begin with ./plugins/",
    )
    require(
        codex_entry.get("policy")
        == {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
        "Codex policy must be AVAILABLE with ON_INSTALL authentication",
    )
    require(
        codex_entry.get("category") == "Productivity",
        "Codex catalog category must be Productivity",
    )
    plugin_root = resolve_plugin_root(root, codex_path)
    manifest = validate_plugin(codex_entry, plugin_root, root)

    require(
        set(claude) == {"name", "owner", "description", "plugins"},
        "Claude catalog contains missing or unsupported top-level fields",
    )
    require(claude.get("name") == "lawoss", "Claude marketplace name must be lawoss")
    require(claude.get("owner") == {"name": "LAWOSS"}, "Claude owner must be LAWOSS")
    require(
        isinstance(claude.get("description"), str) and claude["description"].strip(),
        "Claude marketplace description is required for strict validation",
    )
    claude_plugins = claude.get("plugins")
    require(isinstance(claude_plugins, list), "Claude catalog plugins must be an array")
    require(
        [entry.get("name") for entry in claude_plugins] == ["crz"],
        "Claude catalog must expose only CRZ",
    )
    claude_entry = claude_plugins[0]
    require(
        set(claude_entry) == {"name", "source", "description", "version", "category"},
        "Claude plugin entry contains missing or unsupported fields",
    )
    claude_path = claude_entry.get("source")
    require(
        isinstance(claude_path, str) and claude_path.startswith("./plugins/"),
        "Claude plugin source must be a relative path string under ./plugins/",
    )
    resolve_plugin_root(root, claude_path)

    codex_projection = {
        "marketplace": codex["name"],
        "owner": manifest["author"]["name"],
        "plugin": codex_entry["name"],
        "description": manifest["description"],
        "category": codex_entry["category"],
        "version": manifest["version"],
        "source": codex_path,
    }
    claude_projection = {
        "marketplace": claude["name"],
        "owner": claude["owner"]["name"],
        "plugin": claude_entry["name"],
        "description": claude_entry["description"],
        "category": claude_entry["category"],
        "version": claude_entry["version"],
        "source": claude_path,
    }
    require(
        codex_projection == claude_projection,
        "Codex and Claude catalogs have different semantic projections",
    )
    return len(codex_plugins)


def is_private_hostname(hostname: str) -> bool:
    lowered = hostname.lower().rstrip(".")
    labels = lowered.split(".")
    return (
        lowered.endswith(".ts.net")
        or any(
            label in {"private", "internal", "local", "lan", "home"}
            for label in labels
        )
        or ("dokploy" in labels and labels[-1] not in {"yml", "yaml"})
    )


def validate_public_tree(root: Path) -> None:
    for path in root.rglob("*"):
        if not path.is_file() or ".git" in path.parts or "__pycache__" in path.parts:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue

        relative = path.relative_to(root)
        require(
            not any(pattern.search(text) for pattern in SECRET_SIGNATURES),
            f"secret signature found in {relative}",
        )
        require(
            not MACOS_USER_PATH.search(text),
            f"user-specific macOS path found in {relative}",
        )
        require(
            not WINDOWS_USER_PATH.search(text),
            f"user-specific Windows path found in {relative}",
        )
        require(
            not DEPLOYMENT_ID.search(text),
            f"deployment identifier found in {relative}",
        )

        for candidate in IPV4_CANDIDATE.findall(text):
            try:
                address = ipaddress.ip_address(candidate)
            except ValueError:
                continue
            require(
                not any(address in network for network in PRIVATE_NETWORKS),
                f"private network address found in {relative}",
            )

        for match in URL.finditer(text):
            hostname = (urlparse(match.group(0)).hostname or "").lower()
            require(
                hostname in ALLOWED_PUBLIC_HOSTS or hostname in ALLOWED_LOOPBACK_HOSTS,
                f"unapproved URL hostname found in {relative}",
            )

        for hostname in HOSTNAME_CANDIDATE.findall(text):
            require(
                not is_private_hostname(hostname),
                f"private infrastructure hostname found in {relative}",
            )


def validate_repository(root: Path) -> int:
    root = root.resolve()
    require(root.is_dir(), f"marketplace root is not a directory: {root}")
    count = validate_catalogs(root)
    validate_public_tree(root)
    return count


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=DEFAULT_ROOT,
        help="marketplace root to validate (defaults to this repository)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        count = validate_repository(args.root)
    except ValidationFailure as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        return 1

    print(
        "Validated Codex and Claude schemas, one semantic projection, "
        f"and {count} public-safe plugin wrapper."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
