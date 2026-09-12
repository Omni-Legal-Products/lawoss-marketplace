#!/usr/bin/env python3
"""Build a validated CRZ catalog candidate from committed, reviewed inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?')


def run(command, **kwargs):
    return subprocess.run(command, check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def export_tree(root, commit, destination, archive):
    with archive.open('wb') as stream:
        subprocess.run(['git', '-C', str(root), 'archive', commit], stdout=stream, check=True)
    with tarfile.open(archive) as bundle:
        if any(item.issym() or item.islnk() for item in bundle.getmembers()):
            raise ValueError('Catalog release cannot contain symlinks')
        bundle.extractall(destination, filter='data')


def release(root, source, version, output):
    root, source, output = root.resolve(), source.resolve(), output.absolute()
    if not VERSION.fullmatch(version) or output.exists() or output.is_symlink():
        raise ValueError('Use a valid semantic version and a new output directory')
    if output.resolve().is_relative_to(root) or output.resolve().is_relative_to(source):
        raise ValueError('Output must be outside the source and catalog checkouts')
    if run(['git', '-C', str(root), 'status', '--porcelain']):
        raise ValueError('Commit reviewed changes first; catalog must be clean')
    commit = run(['git', '-C', str(root), 'rev-parse', 'HEAD'])
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='lawoss-release-', dir=output.parent) as directory:
        work = Path(directory)
        candidate = work / 'catalog'
        export_tree(root, commit, candidate, work / 'catalog.tar')
        ledger = json.loads((candidate / 'releases.json').read_text())
        record = next(item for item in ledger['releases'] if item['name'] == 'crz')
        if record['repository'] != 'Omni-Legal-Products/mcp-crz' or not re.fullmatch('[0-9a-f]{40}', record['commit']):
            raise ValueError('Missing reviewed CRZ source identity')
        resolved = run(['git', '-C', str(source), 'rev-parse', record['commit'] + '^{commit}'])
        if resolved != record['commit']:
            raise ValueError('Source checkout does not contain the reviewed commit')
        manifest_path = candidate / 'plugins/crz/.codex-plugin/plugin.json'
        manifest = json.loads(manifest_path.read_text())
        if manifest['version'] == version:
            raise ValueError('A changed release needs a distinct plugin version')
        previous_commit = json.loads((candidate / 'plugins/crz/runtime/provenance.json').read_text())['commit']
        # Existing packager exports only the allowlisted commit and runs its tests.
        run([sys.executable, str(candidate / 'scripts/package_crz.py'), '--source', str(source)])
        manifest['version'] = version
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
        readme = candidate / 'plugins/crz/README.md'
        readme.write_text(readme.read_text().replace(previous_commit, record['commit']))
        record['distribution'] = 'local-mcp-skill-cli'
        (candidate / 'releases.json').write_text(json.dumps(ledger, indent=2) + '\n')
        run([sys.executable, str(candidate / 'scripts/sync_claude.py')])
        provenance = candidate / 'plugins/crz/runtime/provenance.json'
        report = {'plugin': 'crz', 'plugin_version': version, 'catalog_commit': commit,
                  'source_repository': record['repository'], 'source_commit': record['commit'],
                  'runtime_manifest_sha256': hashlib.sha256(provenance.read_bytes()).hexdigest()}
        (candidate / 'release-candidate.json').write_text(json.dumps(report, indent=2) + '\n')
        run([sys.executable, str(candidate / 'scripts/validate.py')])
        # Publish the complete directory only after the build and validation pass.
        if output.exists() or output.is_symlink():
            raise ValueError('Output appeared while building; refusing to overwrite')
        candidate.rename(output)
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(release(ROOT, args.source, args.version, args.output), indent=2))
    except (ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Release failed: {error}\n')


if __name__ == '__main__':
    main()
