import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / 'scripts/runtime-launcher.mjs'
CRZ_RUNTIME = ROOT / 'plugins/crz/runtime'
NODE = shutil.which('node')


class RuntimeLauncherTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='lawoss launcher ')
        self.base = Path(self.directory.name)
        self.plugin = self.base / 'plugin with spaces'
        (self.plugin / 'scripts').mkdir(parents=True)
        shutil.copy2(LAUNCHER, self.plugin / 'scripts/run.mjs')
        shutil.copytree(CRZ_RUNTIME, self.plugin / 'runtime')
        self.write_config()
        self.refresh_provenance()

    def tearDown(self):
        self.directory.cleanup()

    def write_config(self, **changes):
        config = {
            'name': 'fixture-plugin',
            'entrypoint': 'dist/index.js',
            'minimumNode': '22.14.0',
        }
        config.update(changes)
        self.config_bytes = (json.dumps(config, separators=(',', ':')) + '\n').encode()
        (self.plugin / 'runtime-config.json').write_bytes(self.config_bytes)

    def refresh_provenance(self):
        runtime = self.plugin / 'runtime'
        files = {
            path.relative_to(runtime).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(runtime.rglob('*'))
            if path.is_file() and path.name != 'provenance.json'
        }
        manifest = {
            'repository': 'example/runtime',
            'commit': 'a' * 40,
            'configSha256': hashlib.sha256((self.plugin / 'runtime-config.json').read_bytes()).hexdigest(),
            'files': files,
        }
        (runtime / 'provenance.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')

    def run_cli(self, *args, path=None, cache=None, state=None):
        env = {**os.environ, 'LAWOSS_CACHE_DIR': str(cache or self.base / 'cache')}
        if state is not None:
            env['LAWOSS_STATE_DIR'] = str(state)
        if path is not None:
            env['PATH'] = path
        return subprocess.run(
            [NODE, str(self.plugin / 'scripts/run.mjs'), *args],
            capture_output=True,
            text=True,
            timeout=20,
            env=env,
        )

    def assert_rejected_before_install(self, args, message=None):
        result = self.run_cli(*args, path='')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertNotIn('Installing', result.stderr)
        self.assertFalse((self.base / 'cache').exists())
        if message:
            self.assertIn(message, result.stderr)

    def test_doctor_reports_selected_runtime_and_provenance_abi_cache(self):
        result = self.run_cli('doctor', path='')
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        provenance = (self.plugin / 'runtime/provenance.json').read_bytes()
        digest = hashlib.sha256(provenance).hexdigest()[:24]
        self.assertEqual(report['runtime'], 'fixture-plugin')
        self.assertIsNone(report['server'])
        self.assertEqual(report['commit'], 'a' * 40)
        self.assertFalse(report['cached'])
        self.assertIn(f'/fixture-plugin/{digest}-', report['cache'])
        self.assertTrue(Path(report['cache']).is_absolute())
        self.assertEqual(Path(report['statePath']), Path(report['cache']).parent / 'state')
        self.assertFalse(Path(report['statePath']).exists())

    def test_state_override_keeps_mutable_data_outside_code_cache(self):
        state = self.base / 'persistent-volume'
        result = self.run_cli('doctor', state=state)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(Path(report['statePath']), state / 'fixture-plugin')
        self.assertFalse(Path(report['statePath']).is_relative_to(Path(report['cache'])))
        self.assertFalse(state.exists())

    def test_server_selector_uses_named_or_default_entrypoint(self):
        self.write_config(
            servers={'justice': 'dist/server.js', 'insolvency': 'dist/scalars.js'},
            defaultServer='justice',
        )
        self.refresh_provenance()
        default = self.run_cli('doctor', path='')
        selected = self.run_cli('--server', 'insolvency', 'doctor', path='')
        self.assertEqual(default.returncode, 0, default.stderr)
        self.assertEqual(selected.returncode, 0, selected.stderr)
        self.assertEqual(json.loads(default.stdout)['server'], 'justice')
        self.assertEqual(json.loads(default.stdout)['entrypoint'], 'dist/server.js')
        self.assertEqual(json.loads(selected.stdout)['server'], 'insolvency')
        self.assertEqual(json.loads(selected.stdout)['entrypoint'], 'dist/scalars.js')

    def test_bad_cli_inputs_are_rejected_before_runtime_or_npm_work(self):
        for args in [
            ('unknown',),
            ('doctor', 'extra'),
            ('--server',),
            ('--server', 'missing', 'doctor'),
            ('call',),
            ('call', 'tool'),
            ('call', 'tool', 'not-json'),
            ('call', 'tool', '[]'),
            ('call', 'tool', 'null'),
            ('tools', 'extra'),
        ]:
            with self.subTest(args=args):
                self.assert_rejected_before_install(args)

    def test_help_needs_no_config_runtime_or_npm(self):
        shutil.rmtree(self.plugin / 'runtime')
        (self.plugin / 'runtime-config.json').unlink()
        result = self.run_cli('--help', path='')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('[--server NAME] [mcp|doctor|tools|call TOOL JSON|--help]', result.stdout)

    def test_tampered_config_hash_and_runtime_hash_are_rejected(self):
        self.write_config(name='changed-name')
        self.assert_rejected_before_install(('doctor',), 'configuration integrity check failed')
        self.write_config()
        self.refresh_provenance()
        with (self.plugin / 'runtime/dist/index.js').open('a') as stream:
            stream.write('\n// changed\n')
        self.assert_rejected_before_install(('doctor',), 'Runtime integrity check failed')

    def test_unlisted_runtime_files_and_symlinks_are_rejected(self):
        (self.plugin / 'runtime/extra.js').write_text('export {}\n')
        self.assert_rejected_before_install(('doctor',), 'unlisted file')
        (self.plugin / 'runtime/extra.js').unlink()
        target = self.plugin / 'outside.js'
        target.write_text('export {}\n')
        (self.plugin / 'runtime/dist/index.js').unlink()
        (self.plugin / 'runtime/dist/index.js').symlink_to(target)
        self.assert_rejected_before_install(('doctor',), 'symbolic links')

    def test_unsafe_config_and_manifest_paths_are_rejected(self):
        mutations = [
            ({'entrypoint': '../outside.js'}, None, 'safe relative'),
            ({'entrypoint': '/tmp/outside.js'}, None, 'safe relative'),
            ({'entrypoint': 'dist\\index.js'}, None, 'safe relative'),
            ({'entrypoint': 'dist/missing.js'}, None, 'listed in provenance'),
            ({'entrypoint': 'package.json'}, None, 'JavaScript file'),
            ({'name': '../shared'}, None, 'plugin slug'),
            ({'minimumNode': '22'}, None, 'semantic version'),
            ({'servers': {'../bad': 'dist/server.js'}}, None, 'server slug'),
            ({'servers': {'ok': '../outside.js'}}, None, 'safe relative'),
            ({'servers': {'ok': 'dist/missing.js'}}, None, 'listed in provenance'),
            ({'defaultServer': 'missing', 'servers': {'ok': 'dist/server.js'}}, None, 'defaultServer'),
            ({'nativeBuilds': ['arbitrary-package']}, None, 'supported native package'),
            ({'nativeBuilds': 'better-sqlite3'}, None, 'array'),
            ({'unexpected': True}, None, 'unknown field'),
            ({}, '../outside.js', 'safe relative'),
        ]
        for config_change, manifest_path, message in mutations:
            with self.subTest(change=config_change, manifest=manifest_path):
                self.write_config(**config_change)
                self.refresh_provenance()
                if manifest_path:
                    provenance_path = self.plugin / 'runtime/provenance.json'
                    manifest = json.loads(provenance_path.read_text())
                    manifest['files'][manifest_path] = '0' * 64
                    provenance_path.write_text(json.dumps(manifest))
                self.assert_rejected_before_install(('doctor',), message)

    def test_runtime_config_and_runtime_directory_symlinks_are_rejected(self):
        config_target = self.plugin / 'config-target.json'
        config_target.write_bytes((self.plugin / 'runtime-config.json').read_bytes())
        (self.plugin / 'runtime-config.json').unlink()
        (self.plugin / 'runtime-config.json').symlink_to(config_target)
        self.assert_rejected_before_install(('doctor',), 'symbolic links')

        (self.plugin / 'runtime-config.json').unlink()
        shutil.copy2(config_target, self.plugin / 'runtime-config.json')
        runtime_target = self.plugin / 'runtime-target'
        (self.plugin / 'runtime').rename(runtime_target)
        (self.plugin / 'runtime').symlink_to(runtime_target, target_is_directory=True)
        self.assert_rejected_before_install(('doctor',), 'symbolic links')

    def test_warm_cache_doctor_does_not_need_npm_and_rejects_corruption(self):
        (self.plugin / 'runtime/dist/index.js').write_text(
            'import {writeFileSync} from "node:fs";'
            'writeFileSync("launched.txt", process.cwd());'
            'process.exit(0)\n'
        )
        self.refresh_provenance()
        cold = self.run_cli('doctor', path='')
        self.assertEqual(cold.returncode, 0, cold.stderr)
        report = json.loads(cold.stdout)
        cache = Path(report['cache'])
        cache.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(self.plugin / 'runtime', cache)
        (cache / '.ready').write_text(report['cacheKey'])

        warm = self.run_cli('doctor', path='')
        self.assertEqual(warm.returncode, 0, warm.stderr)
        self.assertTrue(json.loads(warm.stdout)['cached'])
        launched = self.run_cli('mcp', path='')
        self.assertEqual(launched.returncode, 0, launched.stderr)
        state = Path(report['statePath'])
        self.assertEqual(Path((state / 'launched.txt').read_text()).resolve(), state.resolve())
        self.assertFalse((cache / 'launched.txt').exists())
        (cache / 'dist/index.js').write_text('damaged\n')
        result = self.run_cli('doctor', path='')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Cached runtime integrity check failed', result.stderr)

    def test_cache_is_separated_by_plugin_slug(self):
        first = json.loads(self.run_cli('doctor', path='').stdout)['cache']
        self.write_config(name='another-plugin')
        self.refresh_provenance()
        second = json.loads(self.run_cli('doctor', path='').stdout)['cache']
        self.assertNotEqual(Path(first).parent, Path(second).parent)
        self.assertEqual(Path(first).parent.name, 'fixture-plugin')
        self.assertEqual(Path(second).parent.name, 'another-plugin')

    def test_native_build_is_explicit_and_limited_to_better_sqlite3(self):
        (self.plugin / 'runtime/dist/index.js').write_text('process.exit(0)\n')
        self.write_config(nativeBuilds=['better-sqlite3'])
        self.refresh_provenance()
        fake_bin = self.base / 'bin'
        fake_bin.mkdir()
        npm_log = self.base / 'npm.log'
        npm = fake_bin / 'npm'
        npm.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$NPM_LOG"\nexit 0\n')
        npm.chmod(0o755)
        env = {
            **os.environ,
            'PATH': f'{fake_bin}:/bin:/usr/bin',
            'NPM_LOG': str(npm_log),
            'LAWOSS_CACHE_DIR': str(self.base / 'native-cache'),
        }
        result = subprocess.run(
            [NODE, str(self.plugin / 'scripts/run.mjs'), 'mcp'],
            capture_output=True,
            text=True,
            timeout=20,
            env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(npm_log.read_text().splitlines(), [
            '--version',
            'ci --omit=dev --ignore-scripts --no-audit --no-fund',
            'rebuild --foreground-scripts better-sqlite3',
        ])

    def test_warm_cli_preserves_tools_and_call_modes(self):
        cold = self.run_cli('doctor', path='')
        self.assertEqual(cold.returncode, 0, cold.stderr)
        report = json.loads(cold.stdout)
        cache = Path(report['cache'])
        cache.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(self.plugin / 'runtime', cache)
        sdk = cache / 'node_modules/@modelcontextprotocol/sdk'
        (sdk / 'dist/esm/client').mkdir(parents=True)
        (sdk / 'package.json').write_text('{"type":"module"}\n')
        (sdk / 'dist/esm/client/index.js').write_text(
            'export class Client {'
            ' async connect(transport) { this.transport = transport; }'
            ' async listTools() { return {tools:[{name:"fixture_tool"}],cwd:this.transport.options.cwd}; }'
            ' async callTool(request) { return {request}; }'
            ' async close() {}'
            '}\n'
        )
        (sdk / 'dist/esm/client/stdio.js').write_text(
            'export class StdioClientTransport { constructor(options) { this.options = options; } }\n'
        )
        (cache / '.ready').write_text(report['cacheKey'])

        tools = self.run_cli('tools', path='')
        call = self.run_cli('call', 'fixture_tool', '{"value":7}', path='')
        self.assertEqual(tools.returncode, 0, tools.stderr)
        self.assertEqual(call.returncode, 0, call.stderr)
        self.assertEqual(json.loads(tools.stdout), {
            'tools': [{'name': 'fixture_tool'}],
            'cwd': report['statePath'],
        })
        self.assertEqual(json.loads(call.stdout), {
            'request': {'name': 'fixture_tool', 'arguments': {'value': 7}},
        })


if __name__ == '__main__':
    unittest.main()
