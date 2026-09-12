#!/usr/bin/env python3
"""Build a validated catalog candidate for one reviewed LAWOSS runtime plugin."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile


ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?')
REPOSITORIES = {
    'crz': 'Omni-Legal-Products/mcp-crz',
    'cz-agents': 'Omni-Legal-Products/mcp-cz-agents',
    'disq': 'Omni-Legal-Products/mcp-diskvalifikacie',
    'eurlex-celex': 'Omni-Legal-Products/mcp-eurlex',
    'fs-opendata-mcp': 'Omni-Legal-Products/mcp-financna-sprava',
    'judikaty': 'Omni-Legal-Products/mcp-judikaty-sk',
    'kalkulacky': 'Omni-Legal-Products/mcp-kalkulacky-sk',
    'orsr': 'Omni-Legal-Products/mcp-orsr',
    'ov': 'Omni-Legal-Products/mcp-obchodny-vestnik',
    'rpo': 'Omni-Legal-Products/mcp-rpo',
    'rpvs': 'Omni-Legal-Products/mcp-rpvs',
    'ru': 'Omni-Legal-Products/mcp-register-upadcov',
    'ruz': 'Omni-Legal-Products/mcp-ruz',
    'slovlex': 'Omni-Legal-Products/mcp-slovlex',
    'uvo': 'Omni-Legal-Products/mcp-uvo',
}


def run(command, **kwargs):
    return subprocess.run(command, check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_crz_release(root):
    return load_module(root / 'scripts/release_crz.py', 'lawoss_release_crz')


def load_packager(root):
    return load_module(root / 'scripts/package_runtime.py', 'lawoss_package_runtime')


def export_tree(root, commit, destination, archive):
    with archive.open('wb') as stream:
        subprocess.run(['git', '-C', str(root), 'archive', commit], stdout=stream, check=True)
    with tarfile.open(archive) as bundle:
        if any(item.issym() or item.islnk() for item in bundle.getmembers()):
            raise ValueError('Catalog release cannot contain symlinks')
        bundle.extractall(destination, filter='data')


def release(root, plugin, source, version, output):
    if plugin == 'crz':
        return load_crz_release(root).release(root, source, version, output)
    if plugin not in REPOSITORIES:
        raise ValueError('Plugin is not in the LAWOSS release allowlist')
    root, source, output = root.resolve(), source.resolve(), output.absolute()
    if not VERSION.fullmatch(version) or output.exists() or output.is_symlink():
        raise ValueError('Use a valid semantic version and a new output directory')
    if output.resolve().is_relative_to(root) or output.resolve().is_relative_to(source):
        raise ValueError('Output must be outside the source and catalog checkouts')
    if run(['git', '-C', str(root), 'status', '--porcelain']):
        raise ValueError('Commit reviewed changes first; catalog must be clean')
    catalog_commit = run(['git', '-C', str(root), 'rev-parse', 'HEAD'])
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='lawoss-release-', dir=output.parent) as directory:
        work = Path(directory)
        candidate = work / 'catalog'
        export_tree(root, catalog_commit, candidate, work / 'catalog.tar')
        ledger_path = candidate / 'releases.json'
        ledger = json.loads(ledger_path.read_text())
        records = [record for record in ledger.get('releases', []) if record.get('name') == plugin]
        if len(records) != 1:
            raise ValueError('Missing reviewed source identity')
        record = records[0]
        if record.get('repository') != REPOSITORIES[plugin] or not re.fullmatch(r'[0-9a-f]{40}', record.get('commit', '')):
            raise ValueError('Missing reviewed source identity')
        specifications = json.loads((candidate / 'runtime-packages.json').read_text())
        if plugin not in specifications:
            raise ValueError('Plugin has no reviewed runtime package specification')
        resolved = run(['git', '-C', str(source), 'rev-parse', record['commit'] + '^{commit}'])
        if resolved != record['commit']:
            raise ValueError('Source checkout does not contain the exact reviewed commit')

        plugin_root = candidate / 'plugins' / plugin
        manifest_path = plugin_root / '.codex-plugin/plugin.json'
        manifest = json.loads(manifest_path.read_text())
        if manifest.get('version') == version:
            raise ValueError('A changed release needs a distinct plugin version')
        provenance_path = plugin_root / 'runtime/provenance.json'
        previous_commit = json.loads(provenance_path.read_text()).get('commit') if provenance_path.exists() else record['commit']

        packager = load_packager(candidate)
        packager.build(plugin, source, root=candidate)
        provenance = json.loads(provenance_path.read_text())
        if (provenance.get('repository'), provenance.get('commit')) != (record['repository'], record['commit']):
            raise ValueError('Packaged artifact does not match the reviewed source')
        if not isinstance(provenance.get('files'), dict) or not provenance['files']:
            raise ValueError('Packaged artifact has no runtime file inventory')

        manifest['version'] = version
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
        readme = plugin_root / 'README.md'
        readme.write_text(readme.read_text().replace(previous_commit, record['commit']))
        if record['commit'] not in readme.read_text():
            raise ValueError('Plugin README does not identify the reviewed source commit')
        record['distribution'] = 'local-mcp-skill-cli'
        ledger_path.write_text(json.dumps(ledger, indent=2) + '\n')
        run([sys.executable, str(candidate / 'scripts/sync_claude.py')])

        claude_manifest = json.loads((plugin_root / '.claude-plugin/plugin.json').read_text())
        claude_catalog = json.loads((candidate / '.claude-plugin/marketplace.json').read_text())
        counterpart = next(item for item in claude_catalog['plugins'] if item['name'] == plugin)
        if claude_manifest.get('version') != version or counterpart.get('version') != version:
            raise ValueError('Claude release projection did not receive the new version')

        report = {
            'plugin': plugin,
            'plugin_version': version,
            'catalog_commit': catalog_commit,
            'source_repository': record['repository'],
            'source_commit': record['commit'],
            'runtime_manifest_sha256': hashlib.sha256(provenance_path.read_bytes()).hexdigest(),
        }
        (candidate / 'release-candidate.json').write_text(json.dumps(report, indent=2) + '\n')
        run([sys.executable, str(candidate / 'scripts/validate.py')])
        if output.exists() or output.is_symlink():
            raise ValueError('Output appeared while building; refusing to overwrite')
        candidate.rename(output)
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plugin', choices=sorted(REPOSITORIES), required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(release(ROOT, args.plugin, args.source, args.version, args.output), indent=2))
    except (ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Release failed: {error}\n')


if __name__ == '__main__':
    main()
