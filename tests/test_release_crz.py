import importlib.util
import json
from pathlib import Path
import subprocess
import shutil
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def export_fixture(root, commit, candidate, archive):
    shutil.copytree(ROOT, candidate, ignore=shutil.ignore_patterns('.git', '__pycache__'))
    path = candidate / 'plugins/crz/.codex-plugin/plugin.json'
    manifest = json.loads(path.read_text())
    manifest['version'] = '0.0.0'
    path.write_text(json.dumps(manifest))


class ReleaseTest(unittest.TestCase):
    def module(self):
        spec = importlib.util.spec_from_file_location('release_crz', ROOT / 'scripts/release_crz.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_invalid_version_and_existing_output_do_not_run_build(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'run') as run:
            output = Path(directory) / 'occupied'
            output.mkdir()
            for version in ['1.4.1', 'bad/version']:
                with self.assertRaises(ValueError):
                    module.release(ROOT, ROOT, version, output)
            run.assert_not_called()

    def test_dirty_catalog_fails_before_packaging(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'run', return_value=' M README.md') as run:
            output = Path(directory) / 'candidate'
            with self.assertRaisesRegex(ValueError, 'clean'):
                module.release(ROOT, ROOT, '1.4.1', output)
            self.assertFalse(output.exists())
            self.assertEqual(run.call_count, 1)

    def test_failed_build_leaves_checkout_and_output_untouched(self):
        module = self.module()
        before = (ROOT / 'plugins/crz/.codex-plugin/plugin.json').read_bytes()
        real_run = module.run
        reached_build = []

        def fail_build(command, **kwargs):
            if 'status' in command:
                return ''
            if str(command[-1]).endswith('^{commit}'):
                return command[-1].removesuffix('^{commit}')
            if 'rev-parse' in command:
                return 'a' * 40
            if any(str(part).endswith('package_crz.py') for part in command):
                reached_build.append(True)
                raise subprocess.CalledProcessError(1, command)
            return real_run(command, **kwargs)

        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'run', side_effect=fail_build), patch.object(module, 'export_tree', side_effect=export_fixture):
            output = Path(directory) / 'candidate'
            with self.assertRaises(subprocess.CalledProcessError):
                module.release(ROOT, ROOT, '1.4.1', output)
            self.assertFalse(output.exists())
            self.assertEqual(before, (ROOT / 'plugins/crz/.codex-plugin/plugin.json').read_bytes())
            self.assertTrue(reached_build)

    def test_new_reviewed_commit_updates_candidate_provenance_and_readme(self):
        module = self.module()
        new_commit = 'a' * 40
        real_run = module.run

        def export(root, commit, candidate, archive):
            export_fixture(root, commit, candidate, archive)
            path = candidate / 'releases.json'
            data = json.loads(path.read_text())
            next(r for r in data['releases'] if r['name'] == 'crz')['commit'] = new_commit
            path.write_text(json.dumps(data))

        def commands(command, **kwargs):
            if 'status' in command:
                return ''
            if 'rev-parse' in command:
                return new_commit
            if any(str(part).endswith('package_crz.py') for part in command):
                provenance = Path(command[1]).parents[1] / 'plugins/crz/runtime/provenance.json'
                data = json.loads(provenance.read_text())
                data['commit'] = new_commit
                provenance.write_text(json.dumps(data))
                return ''
            return real_run(command, **kwargs)

        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'export_tree', side_effect=export), patch.object(module, 'run', side_effect=commands):
            output = Path(directory) / 'candidate'
            report = module.release(ROOT, ROOT, '1.4.1', output)
            self.assertEqual(report['source_commit'], new_commit)
            self.assertIn(new_commit, (output / 'plugins/crz/README.md').read_text())
            manifest = json.loads((output / 'plugins/crz/.codex-plugin/plugin.json').read_text())
            self.assertEqual(manifest['version'], '1.4.1')


if __name__ == '__main__':
    unittest.main()
