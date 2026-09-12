#!/usr/bin/env python3
"""Build the reviewed CRZ revision into a portable, inspectable plugin runtime."""
import argparse
import hashlib
import json
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    release = next(r for r in json.loads((ROOT / 'releases.json').read_text())['releases'] if r['name'] == 'crz')
    with tempfile.TemporaryDirectory(prefix='lawoss-crz-build-') as directory:
        work = Path(directory)
        archive = work / 'source.tar'
        with archive.open('wb') as stream:
            subprocess.run(['git', '-C', str(args.source), 'archive', release['commit']], stdout=stream, check=True)
        source = work / 'source'
        with tarfile.open(archive) as bundle:
            bundle.extractall(source, filter='data')
        for command in [['npm', 'ci', '--ignore-scripts'], ['npm', 'test'], ['npm', 'run', 'build']]:
            subprocess.run(command, cwd=source, check=True)
        dest = ROOT / 'plugins/crz/runtime'
        staged = work / 'runtime'
        (staged / 'dist/crz').mkdir(parents=True)
        for name in ['package.json', 'package-lock.json', 'LICENSE']:
            shutil.copy2(source / name, staged / name)
        for name in ['index.js', 'server.js', 'scalars.js']:
            shutil.copy2(source / 'dist' / name, staged / 'dist' / name)
        for path in (source / 'dist/crz').glob('*.js'):
            shutil.copy2(path, staged / 'dist/crz' / path.name)
        hashes = {p.relative_to(staged).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in sorted(staged.rglob('*')) if p.is_file()}
        (staged / 'provenance.json').write_text(json.dumps({
            'repository': release['repository'], 'commit': release['commit'],
            'files': hashes,
        }, indent=2) + '\n')
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(staged, dest)
        print(f'Packaged reviewed CRZ runtime: {len(hashes)} files')


if __name__ == '__main__':
    main()
