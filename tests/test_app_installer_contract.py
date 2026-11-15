"""The LAWOSS desktop app installs a catalog plugin only inside its installer contract.

Released app builds refuse a whole Node plugin when a file falls outside
/(?:\\.(?:json|js|mjs|cjs|md)|(?:^|\\/)LICENSE)$/ or the plugin has more than 128 files
(apps/server/src/claude-plugin-bundle.ts). These tests keep the catalog and the packager inside it.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AppInstallerContractTest(unittest.TestCase):
    def setUp(self):
        self.validate = load('lawoss_validate_contract', ROOT / 'scripts/validate.py')

    def test_rule_accepts_what_the_app_accepts(self):
        accepted = ['.claude-plugin/plugin.json', '.mcp.json', 'LICENSE', 'runtime/LICENSE', 'README.md',
                    'runtime/THIRD_PARTY_NOTICES.md', 'scripts/run.mjs', 'runtime/dist/a.cjs', 'runtime/dist/b.js']
        self.assertEqual(self.validate.app_installer_violations(accepted), [])
        self.assertEqual(self.validate.app_installer_violations([f'skills/s{i}/SKILL.md' for i in range(128)]), [])

    def test_rule_refuses_what_the_app_refuses(self):
        for path in ['runtime/THIRD_PARTY_NOTICES.txt', 'LICENSE.txt', 'runtime/LICENSE.md.bak', 'data/rates.csv',
                     'runtime/server.js\n', 'xLICENSE', 'a/../b.js', 'a//b.js', './a.js', 'a/./b.js', 'a\\b.js', '/a.js']:
            with self.subTest(path=path):
                self.assertTrue(self.validate.app_installer_violations([path]))
        problems = self.validate.app_installer_violations([f'skills/s{i}/SKILL.md' for i in range(129)])
        self.assertEqual(len(problems), 1)
        self.assertIn('exceed', problems[0])

    def test_every_plugin_directory_installs_in_the_app(self):
        for plugin in sorted(path for path in (ROOT / 'plugins').iterdir() if path.is_dir()):
            with self.subTest(plugin=plugin.name):
                self.assertEqual(self.validate.app_installer_violations(self.validate.plugin_files(plugin)), [])

    def test_validator_rejects_a_plugin_the_app_would_refuse(self):
        mutations = {
            'stray txt in a catalog plugin': lambda root: (root / 'plugins/zrsr/notes.txt').write_text('x\n'),
            'LICENSE.txt': lambda root: (root / 'plugins/zrsr/LICENSE.txt').write_text('x\n'),
            'too many files': lambda root: [(root / f'plugins/zrsr/skills/extra-{i}.md').write_text('x\n') for i in range(129)],
            'directory outside the catalog': lambda root: ((root / 'plugins/stray').mkdir(), (root / 'plugins/stray/x.txt').write_text('x\n')),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                copied = Path(directory) / 'marketplace'
                shutil.copytree(ROOT, copied, ignore=shutil.ignore_patterns('.git', '__pycache__'))
                mutate(copied)
                result = subprocess.run([sys.executable, str(ROOT / 'scripts/validate.py'), '--root', str(copied)],
                                        capture_output=True, text=True, check=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('LAWOSS app installer would refuse', result.stderr)


class PackagerContractTest(unittest.TestCase):
    def catalog(self, directory):
        copied = Path(directory) / 'marketplace'
        shutil.copytree(ROOT, copied, ignore=shutil.ignore_patterns('.git', '__pycache__'))
        return copied, load('lawoss_package_runtime_contract', copied / 'scripts/package_runtime.py')

    def built(self, directory, entrypoint):
        built = Path(directory) / 'build'
        (built / entrypoint).parent.mkdir(parents=True)
        (built / entrypoint).write_text('export {};\n')
        (built / 'package.json').write_text('{"name": "fixture", "type": "module"}\n')
        (built / 'package-lock.json').write_text('{}\n')
        (built / 'LICENSE').write_text('MIT\n')
        return built

    def test_bundled_runtime_ships_markdown_notices(self):
        with tempfile.TemporaryDirectory() as directory:
            root, packager = self.catalog(directory)
            built = self.built(directory, 'dist/server.js')

            def fake_bundle(built, staged, entries, dom_shims=False):
                for entry in entries:
                    (staged / entry).parent.mkdir(parents=True, exist_ok=True)
                    (staged / entry).write_text('export {};\n')
                return {}

            with patch.object(packager, 'bundle_entrypoints', fake_bundle):
                provenance = packager.package_built('rpo', built, root)
            runtime = root / 'plugins/rpo/runtime'
            self.assertIn('THIRD_PARTY_NOTICES.md', provenance['files'])
            self.assertTrue((runtime / 'THIRD_PARTY_NOTICES.md').is_file())
            self.assertFalse(list(runtime.rglob('*.txt')))

    def test_packager_refuses_an_asset_the_app_would_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            root, packager = self.catalog(directory)
            specs = json.loads((root / 'runtime-packages.json').read_text())
            specs['disq']['assets'] = ['data']
            (root / 'runtime-packages.json').write_text(json.dumps(specs))
            built = self.built(directory, 'dist/server.js')
            (built / 'data').mkdir()
            (built / 'data/rates.csv').write_text('a,b\n')
            before = hashlib.sha256((root / 'plugins/disq/runtime/provenance.json').read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, 'LAWOSS app installer would refuse'):
                packager.package_built('disq', built, root)
            after = hashlib.sha256((root / 'plugins/disq/runtime/provenance.json').read_bytes()).hexdigest()
            self.assertEqual(before, after)


if __name__ == '__main__':
    unittest.main()
