import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / 'scripts/runtime-launcher.mjs'
CRZ_RUNTIME = ROOT / 'plugins/crz/runtime'
NODE = shutil.which('node')


class LauncherFixture:
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

    def run_cli(self, *args, path=None, cache=None, state=None, node=NODE, extra_env=None, timeout=20):
        env = {**os.environ, 'LAWOSS_CACHE_DIR': str(cache or self.base / 'cache'), **(extra_env or {})}
        if state is not None:
            env['LAWOSS_STATE_DIR'] = str(state)
        if path is not None:
            env['PATH'] = path
        return subprocess.run(
            [str(node), str(self.plugin / 'scripts/run.mjs'), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )


class RuntimeLauncherTest(LauncherFixture, unittest.TestCase):
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

    def test_mcp_server_runs_in_the_launcher_process(self):
        # LAWOSS RAM budget (lawoss#367): no second Node.js process per MCP server.
        (self.plugin / 'runtime/dist/index.js').write_text(
            'import {writeFileSync} from "node:fs";'
            'import {fileURLToPath} from "node:url";'
            'writeFileSync("launched.json", JSON.stringify({pid: process.pid, argv1: process.argv[1],'
            ' self: fileURLToPath(import.meta.url), argc: process.argv.length}));'
            'process.exit(0)\n'
        )
        self.refresh_provenance()
        report = json.loads(self.run_cli('doctor', path='').stdout)
        cache = Path(report['cache'])
        cache.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(self.plugin / 'runtime', cache)
        (cache / '.ready').write_text(report['cacheKey'])
        env = {**os.environ, 'LAWOSS_CACHE_DIR': str(self.base / 'cache'), 'PATH': ''}
        process = subprocess.Popen([NODE, str(self.plugin / 'scripts/run.mjs'), 'mcp'],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        stdout, stderr = process.communicate(timeout=20)
        self.assertEqual(process.returncode, 0, stderr)
        self.assertEqual(stdout, '')
        launched = json.loads((Path(report['statePath']) / 'launched.json').read_text())
        self.assertEqual(launched['pid'], process.pid)
        # Entrypoints that check whether they are the main module still start.
        self.assertEqual(launched['argv1'], launched['self'])
        self.assertEqual(launched['argc'], 2)

    def test_concurrent_first_runs_install_once_and_never_in_parallel(self):
        # LAWOSS RAM budget (lawoss#367): one npm installation at a time.
        (self.plugin / 'runtime/dist/index.js').write_text('process.exit(0)\n')
        self.refresh_provenance()
        fake_bin = self.base / 'bin'
        fake_bin.mkdir()
        npm_log = self.base / 'npm.log'
        npm = fake_bin / 'npm'
        npm.write_text(
            '#!/bin/sh\n'
            'if [ "$1" = "ci" ]; then echo "start $(date +%s%N)" >> "$NPM_LOG"; sleep 1; echo "end $(date +%s%N)" >> "$NPM_LOG"; fi\n'
            'exit 0\n'
        )
        npm.chmod(0o755)
        env = {**os.environ, 'PATH': f'{fake_bin}:/bin:/usr/bin', 'NPM_LOG': str(npm_log),
               'LAWOSS_CACHE_DIR': str(self.base / 'shared-cache')}
        launches = [subprocess.Popen([NODE, str(self.plugin / 'scripts/run.mjs'), 'mcp'],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
                    for _ in range(4)]
        for launch in launches:
            _, stderr = launch.communicate(timeout=60)
            self.assertEqual(launch.returncode, 0, stderr)
        events = npm_log.read_text().split()
        # Same runtime version: installed exactly once, the others reuse it.
        self.assertEqual(events[0::2], ['start', 'end'])
        self.assertFalse((self.base / 'shared-cache/.install.lock').exists())

    def test_installations_of_different_plugins_do_not_overlap(self):
        (self.plugin / 'runtime/dist/index.js').write_text('process.exit(0)\n')
        self.refresh_provenance()
        second = self.base / 'second plugin'
        shutil.copytree(self.plugin, second)
        config = json.loads((second / 'runtime-config.json').read_text())
        config['name'] = 'second-fixture'
        (second / 'runtime-config.json').write_text(json.dumps(config, separators=(',', ':')) + '\n')
        manifest = json.loads((second / 'runtime/provenance.json').read_text())
        manifest['configSha256'] = hashlib.sha256((second / 'runtime-config.json').read_bytes()).hexdigest()
        (second / 'runtime/provenance.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
        fake_bin = self.base / 'bin'
        fake_bin.mkdir()
        npm_log = self.base / 'npm.log'
        npm = fake_bin / 'npm'
        npm.write_text(
            '#!/bin/sh\n'
            'if [ "$1" = "ci" ]; then echo "start" >> "$NPM_LOG"; sleep 1; echo "end" >> "$NPM_LOG"; fi\n'
            'exit 0\n'
        )
        npm.chmod(0o755)
        env = {**os.environ, 'PATH': f'{fake_bin}:/bin:/usr/bin', 'NPM_LOG': str(npm_log),
               'LAWOSS_CACHE_DIR': str(self.base / 'shared-cache')}
        launches = [subprocess.Popen([NODE, str(plugin / 'scripts/run.mjs'), 'mcp'],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
                    for plugin in (self.plugin, second)]
        for launch in launches:
            _, stderr = launch.communicate(timeout=60)
            self.assertEqual(launch.returncode, 0, stderr)
        self.assertEqual(npm_log.read_text().split(), ['start', 'end', 'start', 'end'])

    def test_cache_is_separated_by_plugin_slug(self):
        first = json.loads(self.run_cli('doctor', path='').stdout)['cache']
        self.write_config(name='another-plugin')
        self.refresh_provenance()
        second = json.loads(self.run_cli('doctor', path='').stdout)['cache']
        self.assertNotEqual(Path(first).parent, Path(second).parent)
        self.assertEqual(Path(first).parent.name, 'fixture-plugin')
        self.assertEqual(Path(second).parent.name, 'another-plugin')

    @unittest.skipIf(sys.platform == 'win32', 'POSIX resolves npm from PATH first; the fake npm is a shell script')
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


class NpmResolutionTest(LauncherFixture, unittest.TestCase):
    """Cold start runs the real npm, offline, with the layouts LAWOSS ships and the ones users install."""

    WINDOWS = sys.platform == 'win32'

    def setUp(self):
        super().setUp()
        runtime = self.plugin / 'runtime'
        shutil.rmtree(runtime)
        (runtime / 'dist').mkdir(parents=True)
        (runtime / 'dist/index.js').write_text(
            'import {writeFileSync} from "node:fs";'
            'writeFileSync("launched.txt", "ok");'
            'process.exit(0)\n'
        )
        manifest = {'name': 'fixture-plugin', 'version': '1.0.0', 'private': True, 'type': 'module'}
        (runtime / 'package.json').write_text(json.dumps(manifest) + '\n')
        (runtime / 'package-lock.json').write_text(json.dumps({
            'name': 'fixture-plugin', 'version': '1.0.0', 'lockfileVersion': 3, 'requires': True,
            'packages': {'': {'name': 'fixture-plugin', 'version': '1.0.0'}},
        }) + '\n')
        self.refresh_provenance()
        self.npm_env = {
            'npm_config_cache': str(self.base / 'npm-cache'),
            'npm_config_userconfig': str(self.base / 'npmrc'),
            'npm_config_offline': 'true',
            'npm_config_update_notifier': 'false',
        }
        self.real_node = Path(subprocess.run([NODE, '-p', 'process.execPath'], capture_output=True,
                                             text=True, check=True).stdout.strip())

    def real_npm_package(self):
        directory = self.real_node.parent
        for candidate in [directory / 'node_modules/npm', directory / 'lib/node_modules/npm',
                          directory.parent / 'lib/node_modules/npm']:
            if (candidate / 'bin/npm-cli.js').is_file():
                return candidate
        self.skipTest('the Node.js running the tests ships without npm')

    def copy_node(self, directory, npm_layout=None):
        directory.mkdir(parents=True)
        node = directory / self.real_node.name
        shutil.copy2(self.real_node, node)
        if npm_layout:
            shutil.copytree(self.real_npm_package(), directory / npm_layout)
        return node

    def system_path(self, *extra):
        system = [str(Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32')] if self.WINDOWS else []
        return os.pathsep.join([*map(str, extra), *system])

    def assert_cold_start_installs(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('npm is required', result.stderr)
        self.assertIn('Installing locked local dependencies', result.stderr)
        report = json.loads(self.run_cli('doctor', path='', extra_env=self.npm_env).stdout)
        self.assertTrue(report['cached'])
        self.assertTrue((Path(report['cache']) / '.ready').is_file())
        self.assertEqual((Path(report['statePath']) / 'launched.txt').read_text(), 'ok')

    @unittest.skipUnless(sys.platform == 'win32', 'reproduces the Windows-only Node.js .cmd restriction')
    def test_windows_refuses_npm_cmd_without_shell(self):
        # The launcher before this fix probed npm exactly like this and reported "npm is required".
        probe = subprocess.run(
            [NODE, '-e', 'const r=require("node:child_process").spawnSync("npm.cmd",["--version"]);'
                         'console.log(r.error ? r.error.code : r.status)'],
            capture_output=True, text=True, timeout=60, check=True,
        )
        self.assertEqual(probe.stdout.strip(), 'EINVAL')

    def test_cold_start_uses_npm_bundled_by_lawoss_when_path_has_none(self):
        # The LAWOSS app ships node(.exe) with npm in lib/npm on every platform; PATH holds no npm.
        node = self.copy_node(self.base / 'lawoss node', npm_layout='lib/npm')
        result = self.run_cli('mcp', node=node, path=self.system_path(), extra_env=self.npm_env, timeout=240)
        self.assert_cold_start_installs(result)

    def test_cold_start_uses_npm_beside_node_when_path_has_none(self):
        # Official Node.js archives: node_modules/npm beside node.exe, lib/node_modules/npm on POSIX.
        layout = 'node_modules/npm' if self.WINDOWS else 'lib/node_modules/npm'
        node = self.copy_node(self.base / 'bundled node', npm_layout=layout)
        result = self.run_cli('mcp', node=node, path=self.system_path(), extra_env=self.npm_env, timeout=240)
        self.assert_cold_start_installs(result)

    def test_cold_start_uses_npm_from_path_when_none_is_beside_node(self):
        # Windows reaches npm.cmd only through the shell fallback; POSIX keeps its PATH lookup.
        node = self.copy_node(self.base / 'lonely node' / 'bin')
        self.real_npm_package()
        result = self.run_cli('mcp', node=node, path=self.system_path(self.real_node.parent),
                              extra_env=self.npm_env, timeout=240)
        self.assert_cold_start_installs(result)

    def test_cold_start_reports_missing_npm(self):
        node = self.copy_node(self.base / 'no npm' / 'bin')
        result = self.run_cli('mcp', node=node, path=self.system_path(), extra_env=self.npm_env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('npm is required for the first run', result.stderr)


class BundledRuntimeTest(LauncherFixture, unittest.TestCase):
    """A bundled runtime carries its dependencies in the entrypoint: no npm, no network on first run."""

    def setUp(self):
        super().setUp()
        shutil.rmtree(self.plugin / 'runtime')
        shutil.copytree(ROOT / 'plugins/orsr/runtime', self.plugin / 'runtime')
        self.write_config(entrypoint='dist/server.js', bundled=True)
        self.refresh_provenance()

    def test_cold_start_lists_tools_without_npm_or_path(self):
        result = self.run_cli('tools', path='', timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('Installing', result.stderr)
        self.assertTrue(json.loads(result.stdout)['tools'])
        self.assertFalse(list((self.base / 'cache').rglob('node_modules')))

    def test_mcp_mode_answers_initialize_without_npm(self):
        env = {**os.environ, 'PATH': '', 'LAWOSS_CACHE_DIR': str(self.base / 'cache')}
        request = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
            'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '1'}}}) + '\n'
        process = subprocess.Popen([NODE, str(self.plugin / 'scripts/run.mjs'), 'mcp'], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        try:
            process.stdin.write(request)
            process.stdin.flush()
            answer = json.loads(process.stdout.readline())
        finally:
            process.kill()
            process.communicate()
        self.assertEqual(answer['id'], 1)
        self.assertIn('serverInfo', answer['result'])

    def test_bundled_runtime_cannot_declare_native_builds(self):
        self.write_config(entrypoint='dist/server.js', bundled=True, nativeBuilds=['better-sqlite3'])
        self.refresh_provenance()
        result = self.run_cli('doctor', path='')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('cannot declare nativeBuilds', result.stderr)

    def test_bundled_flag_must_be_true(self):
        self.write_config(entrypoint='dist/server.js', bundled='yes')
        self.refresh_provenance()
        result = self.run_cli('doctor', path='')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('bundled must be true', result.stderr)


if __name__ == '__main__':
    unittest.main()
