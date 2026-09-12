#!/usr/bin/env python3
"""Exercise a real Git marketplace update/rollback using an isolated local HTTP fixture."""
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]


def run(args, cwd, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise RuntimeError(f'{args[0:3]} failed: {result.stderr}')
    return result.stdout


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


with tempfile.TemporaryDirectory(prefix='lawoss update rehearsal ') as temp:
    base = Path(temp)
    repo, profile = base / 'catalog', base / 'profile'
    shutil.copytree(ROOT, repo, ignore=shutil.ignore_patterns('.git', '__pycache__'))
    profile.mkdir()
    env = {**os.environ, 'CODEX_HOME': str(profile), 'LAWOSS_CACHE_DIR': str(base / 'cache')}
    git = ['git', '-c', 'user.name=Local Test', '-c', 'user.email=test@example.com']
    run(git + ['init', '-q'], repo)
    run(git + ['add', '.'], repo)
    run(git + ['commit', '-qm', 'Initial fixture'], repo)
    original = run(git + ['rev-parse', 'HEAD'], repo).strip()
    run(git + ['update-server-info'], repo)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(repo / '.git')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        run(['codex', 'plugin', 'marketplace', 'add', f'http://127.0.0.1:{server.server_port}/', '--json'], base, env)
        caches = []
        for stage in ['install', 'update', 'rollback']:
            if stage == 'update':
                path = repo / 'plugins/crz/.codex-plugin/plugin.json'
                manifest = json.loads(path.read_text())
                manifest['version'] = '1.4.0+codex.rehearsal-update'
                path.write_text(json.dumps(manifest))
                script = repo / 'plugins/crz/runtime/dist/index.js'
                script.write_text(script.read_text() + '\n// Test fixture version marker\n')
                provenance = repo / 'plugins/crz/runtime/provenance.json'
                data = json.loads(provenance.read_text())
                data['files']['dist/index.js'] = hashlib.sha256(script.read_bytes()).hexdigest()
                provenance.write_text(json.dumps(data))
                skill = repo / 'plugins/crz/skills/crz-register-zmluv/SKILL.md'
                skill.write_text(skill.read_text() + '\nRehearsal skill marker.\n')
                run(['python3', 'scripts/sync_claude.py'], repo)
                run(git + ['add', '.'], repo)
                run(git + ['commit', '-qm', 'Update fixture'], repo)
            elif stage == 'rollback':
                run(git + ['checkout', original, '--', '.'], repo)
                run(git + ['commit', '-qm', 'Rollback fixture'], repo)
            if stage != 'install':
                run(git + ['update-server-info'], repo)
                update_output = run(
                    [sys.executable, str(ROOT / 'scripts/update_plugins.py'), '--marketplace', 'lawoss', '--apply'],
                    base,
                    env,
                )
                listing = json.loads(run(['codex', 'plugin', 'list', '--marketplace', 'lawoss', '--json'], base, env))
                installed = next(item for item in listing['installed'] if item['pluginId'] == 'crz@lawoss')
                plugin = profile / 'plugins' / 'cache' / 'lawoss' / 'crz' / installed['version']
                assert f"crz@lawoss: updated" in update_output
            else:
                installed = json.loads(run(['codex', 'plugin', 'add', 'crz@lawoss', '--json'], base, env))
                plugin = Path(installed['installedPath'])
            node = shutil.which('node')
            tools = json.loads(run([node, str(plugin / 'scripts/run.mjs'), 'tools'], base, env))
            assert len(tools['tools']) == 10
            doctor = json.loads(run([node, str(plugin / 'scripts/run.mjs'), 'doctor'], base, env))
            caches.append(doctor['cache'])
            # No npm or other command can be resolved: warm startup must need none.
            warm = json.loads(run([node, str(plugin / 'scripts/run.mjs'), 'tools'], base, {**env, 'PATH': ''}))
            assert len(warm['tools']) == 10
            has_marker = 'Rehearsal skill marker.' in (plugin / 'skills/crz-register-zmluv/SKILL.md').read_text()
            assert has_marker == (stage == 'update')
            check = json.loads(run([node, str(ROOT / 'scripts/check_codex.mjs')], base, env))
            assert check['toolCount'] == 10 and not check['call'].get('isError')
            results.append({'stage': stage, 'version': installed['version'], 'tools': 10, 'liveRead': True, 'warmStartWithoutNpm': True})
        assert caches[0] != caches[1] and caches[0] == caches[2]
        print(json.dumps({'stages': results, 'cacheSeparationAndRollback': True}, indent=2))
    finally:
        server.shutdown()
