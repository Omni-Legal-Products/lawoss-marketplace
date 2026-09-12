import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LocalRuntimeTest(unittest.TestCase):
    def run_cli(self, plugin, *args):
        return subprocess.run(['node', str(plugin / 'scripts/run.mjs'), *args],
                              capture_output=True, text=True, timeout=20)

    def test_bad_cli_input_does_not_install_dependencies(self):
        plugin = ROOT / 'plugins/crz'
        for args in [('unknown',), ('call', 'crz_recent', 'not-json'), ('call', 'crz_recent', '[]')]:
            result = self.run_cli(plugin, *args)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, '')
            self.assertNotIn('Installing', result.stderr)

    def test_doctor_from_path_with_spaces_and_integrity_failure(self):
        with tempfile.TemporaryDirectory(prefix='lawoss plugin ') as directory:
            plugin = Path(directory) / 'plugin with spaces'
            shutil.copytree(ROOT / 'plugins/crz', plugin)
            result = self.run_cli(plugin, 'doctor')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['runtime'], 'crz')
            with (plugin / 'runtime/dist/index.js').open('a') as f:
                f.write('\n// tampered runtime\n')
            result = self.run_cli(plugin, 'doctor')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('integrity check failed', result.stderr)

    def test_validator_rejects_remote_transport_and_changed_runtime(self):
        for mutation in ['http', 'hash']:
            with tempfile.TemporaryDirectory() as directory:
                copied = Path(directory) / 'catalog'
                shutil.copytree(ROOT, copied, ignore=shutil.ignore_patterns('.git', '__pycache__'))
                plugin = copied / 'plugins/crz'
                if mutation == 'http':
                    (plugin / '.mcp.json').write_text(json.dumps({'mcpServers': {'crz': {'type': 'http', 'url': 'https://mcp.example.com/mcp'}}}))
                else:
                    (plugin / 'runtime/dist/index.js').write_text('changed')
                result = subprocess.run(['python3', str(copied / 'scripts/validate.py')], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('local CRZ transport' if mutation == 'http' else 'runtime digest mismatch', result.stderr)

    def test_relative_cache_is_absolute_and_corruption_is_rejected(self):
        plugin = ROOT / 'plugins/crz'
        with tempfile.TemporaryDirectory() as directory:
            env = {**os.environ, 'LAWOSS_CACHE_DIR': './cache'}
            def doctor():
                return subprocess.run(['node', str(plugin / 'scripts/run.mjs'), 'doctor'], cwd=directory,
                                      env=env, capture_output=True, text=True, timeout=20)
            result = doctor()
            self.assertEqual(result.returncode, 0, result.stderr)
            cache = Path(json.loads(result.stdout)['cache'])
            self.assertTrue(cache.is_absolute())
            shutil.copytree(plugin / 'runtime', cache)
            digest = hashlib.sha256((plugin / 'runtime/provenance.json').read_bytes()).hexdigest()[:24]
            (cache / '.ready').write_text(digest)
            self.assertTrue(json.loads(doctor().stdout)['cached'])
            (cache / 'dist/index.js').write_text('damaged')
            result = doctor()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Cached runtime integrity check failed', result.stderr)


if __name__ == '__main__':
    unittest.main()
