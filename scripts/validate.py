#!/usr/bin/env python3
"""Validate LAWOSS catalogs and their public-safe local wrappers."""

from __future__ import annotations

import argparse
import hashlib
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
ALLOWED_PUBLIC_HOSTS = {"mcp.example.com", "www.crz.gov.sk", "fonts.googleapis.com", "github.com", "mcp.example.org"}
RUNTIME_PUBLIC_HOSTS = {"crz.gov.sk", "api.mistral.ai", "registry.npmjs.org", "opencollective.com", "feross.org", "www.patreon.com"}
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
        manifest.get("skills") == "./skills/" or entry["name"] == "cz-agents",
        "usage wrapper must declare its skills directory",
    )
    require(
        manifest.get("author", {}).get("name") == "LAWOSS",
        "plugin author must be LAWOSS",
    )
    if entry['name'] == 'crz':
        require(manifest.get('mcpServers') == './.mcp.json', 'CRZ must declare its local transport')
        config = load_json(plugin_root / '.mcp.json', root)
        require(config == {'mcpServers': {'crz': {'command': 'node', 'args': ['scripts/run.mjs', 'mcp'], 'cwd': '.', 'startup_timeout_sec': 300}}}, 'local CRZ transport must use the portable stdio launcher only')
        runtime = plugin_root / 'runtime'
        provenance = load_json(runtime / 'provenance.json', root)
        record = next(r for r in load_json(root / 'releases.json', root)['releases'] if r['name'] == 'crz')
        require(provenance.get('commit') == record['commit'] and provenance.get('repository') == record['repository'], 'runtime provenance must match reviewed release')
        files = provenance.get('files', {})
        actual = {p.relative_to(runtime).as_posix() for p in runtime.rglob('*') if p.is_file() and p.name != 'provenance.json'}
        require(set(files) == actual and {'dist/index.js', 'package.json', 'package-lock.json', 'LICENSE'} <= actual, 'runtime manifest must enumerate all shipped files')
        for name, digest in files.items():
            path = (runtime / name).resolve()
            require(path.is_relative_to(runtime.resolve()), 'runtime path escapes plugin')
            require(hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'runtime digest mismatch')
    else:
        require('mcpServers' not in manifest and not (plugin_root / '.mcp.json').exists(), 'unverified wrapper must not declare an MCP transport')

    skills = list((plugin_root / "skills").glob("*/SKILL.md"))
    require(bool(skills) or entry["name"] == "cz-agents", "usage skill is missing")
    for skill in skills:
        require(skill.read_text().startswith("---\n"), "skill frontmatter is missing")
    return manifest


def validate_catalogs(root: Path) -> int:
    codex = load_json(root / ".agents/plugins/marketplace.json", root)
    claude = load_json(root / ".claude-plugin/marketplace.json", root)
    ledger = load_json(root / "releases.json", root)
    records = ledger.get("releases", [])
    require(isinstance(records, list) and len(records) == 15, "15 reviewed organization records required")
    by_name = {r["name"]: r for r in records}
    require(len(by_name) == 15, "duplicate release names")
    for record in records:
        require(bool(re.fullmatch(r"Omni-Legal-Products/mcp-[a-z-]+", record.get("repository", ""))), "organization source required")
        require(bool(re.fullmatch(r"[0-9a-f]{40}", record.get("commit", ""))), "recorded organization commit required")
    require(codex.get("name") == "lawoss", "canonical marketplace name must be lawoss")
    require(codex.get("interface") == {"displayName": "LAWOSS Marketplace"}, "marketplace display name must be LAWOSS Marketplace")
    require(set(claude) == {"name", "owner", "description", "plugins"}, "Claude catalog contains missing or unsupported top-level fields")
    require(claude.get("name") == "lawoss" and claude.get("owner") == {"name": "LAWOSS"}, "Claude marketplace identity mismatch")
    require(bool(claude.get("description")), "Claude marketplace description required")
    entries, counterparts = codex.get("plugins"), claude.get("plugins")
    require(isinstance(entries, list) and isinstance(counterparts, list), "catalog plugins must be arrays")
    names = [e.get("name") for e in entries]
    require(len(names) == len(set(names)) and set(names) == set(by_name), "catalog must match reviewed release records")
    require(names == [e.get("name") for e in counterparts], "Codex and Claude catalogs have different semantic projections")
    for entry, counterpart in zip(entries, counterparts):
        source = entry.get("source", {})
        require(isinstance(source, dict) and source.get("source") == "local", "Codex plugin source must be local")
        relative = source.get("path")
        require(isinstance(relative, str) and relative.startswith("./plugins/"), "Codex plugin source.path must begin with ./plugins/")
        plugin_root = resolve_plugin_root(root, relative)
        require(entry.get("policy") == {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}, "Codex policy must be AVAILABLE with ON_INSTALL authentication")
        require(entry.get("category") == "Productivity", "Codex catalog category must be Productivity")
        manifest = validate_plugin(entry, plugin_root, root)
        require(set(counterpart) == {"name", "source", "description", "version", "category"}, "Claude plugin entry contains missing or unsupported fields")
        other_path = counterpart.get("source")
        require(isinstance(other_path, str) and other_path.startswith("./plugins/"), "Claude plugin source must be a relative path string under ./plugins/")
        resolve_plugin_root(root, other_path)
        expected = {"name": entry["name"], "source": relative, "description": manifest["description"], "version": manifest["version"], "category": entry["category"]}
        require(counterpart == expected, "Codex and Claude catalogs have different semantic projections")
        readme = (plugin_root / "README.md").read_text()
        require(by_name[entry["name"]]["commit"] in readme, "wrapper must identify its reviewed source commit")
    return len(entries)


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
            # XML namespace identifiers are not remote image/service URLs.
            if match.group(0) == "http://www.w3.org/2000/svg":
                continue
            hostname = (urlparse(match.group(0)).hostname or "").lower()
            require(
                hostname in ALLOWED_PUBLIC_HOSTS or hostname in ALLOWED_LOOPBACK_HOSTS
                or (relative.parts[:3] == ('plugins', 'crz', 'runtime') and hostname in RUNTIME_PUBLIC_HOSTS),
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
