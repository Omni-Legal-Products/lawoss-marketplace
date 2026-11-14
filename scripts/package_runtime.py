#!/usr/bin/env python3
"""Build a reviewed source commit into a portable local Node runtime."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def record_for(root, name):
    return next(r for r in json.loads((root / 'releases.json').read_text())['releases'] if r['name'] == name)


# CommonJS dependencies inside an ESM bundle still call `require` for Node built-ins.
BUNDLE_BANNER = ("import { createRequire as __lawossCreateRequire } from 'node:module';"
                 "const require = __lawossCreateRequire(import.meta.url);")


def find_esbuild(built):
    """esbuild comes from ESBUILD_BINARY, the reviewed build's own node_modules, or PATH; never downloaded here."""
    candidates = [os.environ.get('ESBUILD_BINARY'), str(built / 'node_modules/.bin/esbuild'), shutil.which('esbuild')]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise ValueError('esbuild is required for a bundled runtime; set ESBUILD_BINARY or install esbuild.')


def bundle_entrypoints(built, staged, entrypoints):
    """Bundle each stdio entrypoint with its dependencies into one file, so the first run needs no npm.

    Returns the third-party packages that ended up inside the bundles.
    """
    esbuild = find_esbuild(built)
    packages = {}
    for entry in entrypoints:
        target = staged / entry
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='lawoss-bundle-') as directory:
            meta = Path(directory) / 'meta.json'
            subprocess.run([esbuild, str(built / entry), '--bundle', '--platform=node', '--format=esm', '--target=node22',
                            '--legal-comments=none', '--log-level=warning', f'--banner:js={BUNDLE_BANNER}',
                            f'--metafile={meta}', f'--outfile={target}'], cwd=built, check=True, timeout=300)
            inputs = json.loads(meta.read_text())['inputs']
        for path in inputs:
            parts = Path(path).parts
            if 'node_modules' not in parts:
                continue
            index = len(parts) - 1 - parts[::-1].index('node_modules')
            scoped = parts[index + 1].startswith('@')
            directory = built.joinpath(*parts[:index + (3 if scoped else 2)])
            manifest = directory / 'package.json'
            if not manifest.is_file():
                continue
            package = json.loads(manifest.read_text())
            packages[f"{package.get('name')}@{package.get('version')}"] = (package, directory)
    return packages


def third_party_notices(packages):
    """Licence texts of everything bundled; the bundle redistributes this code."""
    blocks = ['Third-party software bundled into this runtime.\n']
    for key in sorted(packages):
        package, directory = packages[key]
        licence = package.get('license')
        licence = licence if isinstance(licence, str) else json.dumps(licence) if licence else 'UNKNOWN'
        text = next((p.read_text(errors='replace').strip() for p in sorted(directory.iterdir())
                     if p.is_file() and re.match(r'(?i)^(licen[sc]e|copying|notice)', p.name)), '')
        blocks.append(f"{'=' * 78}\n{key}\nLicense: {licence}\n\n{text}\n")
    return '\n'.join(blocks)


def package_built(name, built, root=ROOT):
    spec = json.loads((root / 'runtime-packages.json').read_text())[name]
    record = record_for(root, name)
    plugin = root / 'plugins' / name
    config = {'name': name, 'entrypoint': spec['entrypoint'], 'minimumNode': '22.14.0'}
    if 'servers' in spec:
        config.update(servers=spec['servers'], defaultServer=spec['defaultServer'])
    if spec.get('nativeBuilds'):
        config['nativeBuilds'] = spec['nativeBuilds']
    bundled = bool(spec.get('bundled'))
    if bundled and spec.get('nativeBuilds'):
        raise ValueError('A runtime with native builds cannot be bundled')
    if bundled:
        config['bundled'] = True
    config_bytes = (json.dumps(config, indent=2) + '\n').encode()
    entrypoints = list(spec.get('servers', {}).values()) or [spec['entrypoint']]
    workspaces = {}
    for manifest in (built / 'packages').glob('*/package.json'):
        package = json.loads(manifest.read_text())
        if package.get('main'):
            workspaces[package['name']] = (manifest.parent / package['main']).resolve()
    reachable, pending = set(), [(built / entry).resolve() for entry in entrypoints]
    while pending:
        path = pending.pop()
        if path in reachable:
            continue
        if not path.is_file() or not path.is_relative_to(built.resolve()):
            raise ValueError('Missing or escaping stdio dependency')
        reachable.add(path)
        for dependency in re.findall(r'''(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']''', path.read_text()):
            if dependency.startswith('.'):
                pending.append((path.parent / dependency).resolve())
            elif dependency in workspaces:
                pending.append(workspaces[dependency])
    with tempfile.TemporaryDirectory(prefix='lawoss-runtime-') as directory:
        staged = Path(directory) / 'runtime'
        staged.mkdir()
        includes = spec.get('include', ['dist', 'package.json', 'package-lock.json', 'LICENSE']) + spec.get('assets', [])
        if bundled:
            # The lock file only served `npm ci`; a bundle carries its dependencies itself.
            includes = [item for item in includes if item != 'package-lock.json']
        for relative in includes:
            origin = built / relative
            if origin.is_symlink() or not origin.resolve().is_relative_to(built.resolve()):
                raise ValueError('Source path escapes reviewed build')
            if not origin.exists():
                raise ValueError(f'Missing runtime input: {relative}')
            paths = origin.rglob('*') if origin.is_dir() else [origin]
            for source in paths:
                if source.is_symlink():
                    raise ValueError('Runtime symlinks are not distributable')
                if not source.is_file() or source.name.endswith(('.map', '.d.ts', '.test.js')):
                    continue
                if source.suffix == '.js' and (bundled or source.resolve() not in reachable):
                    continue
                target = staged / source.relative_to(built)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
        entries = list(spec.get('servers', {}).values()) or [spec['entrypoint']]
        if bundled:
            (staged / 'THIRD_PARTY_NOTICES.txt').write_text(third_party_notices(bundle_entrypoints(built, staged, entries)))
        if any(not (staged / entry).is_file() for entry in entries):
            raise ValueError('Built stdio entrypoint is missing')
        files = {p.relative_to(staged).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(staged.rglob('*')) if p.is_file()}
        provenance = {'repository': record['repository'], 'commit': record['commit'], 'configSha256': hashlib.sha256(config_bytes).hexdigest(), 'files': files}
        (staged / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
        destination = plugin / 'runtime'
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(staged, destination)
        (plugin / 'runtime-config.json').write_bytes(config_bytes)
        (plugin / 'scripts').mkdir(exist_ok=True)
        shutil.copyfile(root / 'scripts/runtime-launcher.mjs', plugin / 'scripts/run.mjs')
        if name == 'cz-agents':
            shutil.copyfile(root / 'scripts/runtime-policy.mjs', plugin / 'scripts/runtime-policy.mjs')
        return provenance


def build(name, source, root=ROOT):
    record = record_for(root, name)
    env = {key: os.environ[key] for key in ['PATH', 'HOME', 'LANG', 'TMPDIR', 'SystemRoot'] if key in os.environ}
    env['CI'] = 'true'
    with tempfile.TemporaryDirectory(prefix='lawoss-source-') as directory:
        work = Path(directory)
        archive = work / 'source.tar'
        with archive.open('wb') as stream:
            subprocess.run(['git', '-C', str(source), 'archive', record['commit']], stdout=stream, check=True)
        built = work / 'build'
        with tarfile.open(archive) as bundle:
            if any(m.issym() or m.islnk() for m in bundle.getmembers()):
                raise ValueError('Reviewed source symlinks are unsupported')
            bundle.extractall(built, filter='data')
        native = json.loads((root / 'runtime-packages.json').read_text())[name].get('nativeBuilds', [])
        commands = [['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund']]
        commands += [['npm', 'rebuild', '--foreground-scripts', package] for package in native]
        commands += [['npm', 'run', 'build'], ['npm', 'test']]
        for command in commands:
            subprocess.run(command, cwd=built, env=env, check=True, timeout=600)
        return package_built(name, built, root)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plugin', choices=list(json.loads((ROOT / 'runtime-packages.json').read_text())), required=True)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    result = build(args.plugin, args.source)
    print(json.dumps({'plugin': args.plugin, 'source': result['commit'], 'files': len(result['files'])}))
