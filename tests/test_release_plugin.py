import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def copy_candidate(root, commit, candidate, archive):
    shutil.copytree(ROOT, candidate, ignore=shutil.ignore_patterns('.git', '__pycache__'))


class GenericReleaseTest(unittest.TestCase):
    def module(self):
        spec = importlib.util.spec_from_file_location('release_plugin', ROOT / 'scripts/release_plugin.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_generic_workflow_preserves_plugin_specific_acceptance_gates(self):
        workflow = (ROOT / '.github/workflows/release-plugin.yml').read_text()
        release_guide = (ROOT / 'docs/RELEASES.md').read_text()
        self.assertIn('node "plugins/$PLUGIN/scripts/run.mjs" call crz_recent', workflow)
        self.assertIn("payload.get('results')", workflow)
        self.assertIn("runtime-config.json'))['servers']", workflow)
        self.assertIn('--server "$server" doctor', workflow)
        self.assertIn('--server "$server" tools', workflow)
        self.assertIn("server == 'sanctions'", workflow)
        self.assertIn('--server eu-registry call search_company', workflow)
        self.assertIn("result.get('isError')", workflow)
        self.assertIn('claude plugin validate --strict .', release_guide)
        self.assertIn('plugin-creator/scripts/validate_plugin.py', release_guide)

    def test_invalid_plugin_version_and_output_are_rejected_before_git_or_build(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(module, 'run') as run, patch.object(module, 'load_packager') as load_packager:
            occupied = Path(directory) / 'occupied'
            occupied.mkdir()
            cases = [
                ('unknown', '1.1.0', Path(directory) / 'unknown'),
                ('disq', 'bad/version', Path(directory) / 'version'),
                ('disq', '1.1.0', occupied),
                ('disq', '1.1.0', ROOT / 'inside-catalog'),
            ]
            for plugin, version, output in cases:
                with self.subTest(plugin=plugin, version=version, output=output):
                    with self.assertRaises(ValueError):
                        module.release(ROOT, plugin, ROOT, version, output)
            run.assert_not_called()
            load_packager.assert_not_called()

    def test_crz_delegates_to_existing_release_without_generic_packaging(self):
        module = self.module()
        expected = {'plugin': 'crz'}
        delegate = types.SimpleNamespace(release=lambda *args: expected)
        with patch.object(module, 'load_crz_release', return_value=delegate), \
             patch.object(module, 'load_packager') as load_packager:
            result = module.release(ROOT, 'crz', ROOT, '1.4.9', Path('/tmp/new-crz-candidate'))
        self.assertEqual(result, expected)
        load_packager.assert_not_called()

    def test_dirty_catalog_stops_before_export_or_packaging(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(module, 'run', return_value=' M README.md'), \
             patch.object(module, 'export_tree') as export, \
             patch.object(module, 'load_packager') as load_packager:
            with self.assertRaisesRegex(ValueError, 'clean'):
                module.release(ROOT, 'disq', ROOT, '1.1.0', Path(directory) / 'candidate')
            export.assert_not_called()
            load_packager.assert_not_called()

    def test_changed_ledger_repository_is_rejected_before_source_or_build(self):
        module = self.module()

        def export(root, commit, candidate, archive):
            copy_candidate(root, commit, candidate, archive)
            path = candidate / 'releases.json'
            ledger = json.loads(path.read_text())
            next(record for record in ledger['releases'] if record['name'] == 'disq')['repository'] = 'attacker/source'
            path.write_text(json.dumps(ledger))

        def commands(command, **kwargs):
            if 'status' in command:
                return ''
            if command[-1] == 'HEAD':
                return 'a' * 40
            self.fail(f'unexpected command after invalid ledger: {command}')

        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'run', side_effect=commands), \
             patch.object(module, 'export_tree', side_effect=export), \
             patch.object(module, 'load_packager') as load_packager:
            with self.assertRaisesRegex(ValueError, 'reviewed source identity'):
                module.release(ROOT, 'disq', ROOT, '1.1.0', Path(directory) / 'candidate')
            load_packager.assert_not_called()

    def test_source_without_exact_reviewed_ref_is_rejected_before_build(self):
        module = self.module()

        def commands(command, **kwargs):
            if 'status' in command:
                return ''
            if command[-1] == 'HEAD':
                return 'a' * 40
            if str(command[-1]).endswith('^{commit}'):
                return 'b' * 40
            raise AssertionError(command)

        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'run', side_effect=commands), \
             patch.object(module, 'export_tree', side_effect=copy_candidate), \
             patch.object(module, 'load_packager') as load_packager:
            with self.assertRaisesRegex(ValueError, 'reviewed commit'):
                module.release(ROOT, 'disq', ROOT, '1.1.0', Path(directory) / 'candidate')
            load_packager.assert_not_called()

    def test_success_updates_versions_provenance_distribution_and_claude_projection(self):
        module = self.module()
        reviewed = 'b' * 40
        catalog_commit = 'a' * 40

        def export(root, commit, candidate, archive):
            copy_candidate(root, commit, candidate, archive)
            ledger_path = candidate / 'releases.json'
            ledger = json.loads(ledger_path.read_text())
            next(record for record in ledger['releases'] if record['name'] == 'disq')['commit'] = reviewed
            ledger_path.write_text(json.dumps(ledger))
            manifest_path = candidate / 'plugins/disq/.codex-plugin/plugin.json'
            manifest = json.loads(manifest_path.read_text())
            manifest['version'] = '0.9.0'
            manifest_path.write_text(json.dumps(manifest))

        def commands(command, **kwargs):
            if 'status' in command:
                return ''
            if command[-1] == 'HEAD':
                return catalog_commit
            if str(command[-1]).endswith('^{commit}'):
                return reviewed
            if any(str(part).endswith('sync_claude.py') for part in command):
                return subprocess.run(command, check=True, text=True, capture_output=True).stdout.strip()
            if any(str(part).endswith('validate.py') for part in command):
                return ''
            raise AssertionError(command)

        def load_packager(candidate):
            def build(plugin, source, root):
                provenance = root / f'plugins/{plugin}/runtime/provenance.json'
                data = json.loads(provenance.read_text())
                data.update(repository='Omni-Legal-Products/mcp-diskvalifikacie', commit=reviewed)
                provenance.write_text(json.dumps(data))
                return data
            return types.SimpleNamespace(build=build)

        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'run', side_effect=commands), \
             patch.object(module, 'export_tree', side_effect=export), \
             patch.object(module, 'load_packager', side_effect=load_packager):
            output = Path(directory) / 'candidate'
            report = module.release(ROOT, 'disq', ROOT, '1.1.0', output)
            self.assertEqual(report['plugin'], 'disq')
            self.assertEqual(report['plugin_version'], '1.1.0')
            self.assertEqual(report['source_commit'], reviewed)
            self.assertEqual(json.loads((output / 'plugins/disq/.codex-plugin/plugin.json').read_text())['version'], '1.1.0')
            self.assertEqual(json.loads((output / 'plugins/disq/.claude-plugin/plugin.json').read_text())['version'], '1.1.0')
            counterpart = next(item for item in json.loads((output / '.claude-plugin/marketplace.json').read_text())['plugins'] if item['name'] == 'disq')
            self.assertEqual(counterpart['version'], '1.1.0')
            record = next(item for item in json.loads((output / 'releases.json').read_text())['releases'] if item['name'] == 'disq')
            self.assertEqual(record['distribution'], 'local-mcp-skill-cli')
            self.assertEqual(json.loads((output / 'release-candidate.json').read_text()), report)

    def test_artifact_appearing_during_build_is_never_overwritten(self):
        module = self.module()
        reviewed = next(record for record in json.loads((ROOT / 'releases.json').read_text())['releases'] if record['name'] == 'disq')['commit']
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'candidate'

            def commands(command, **kwargs):
                if 'status' in command:
                    return ''
                if command[-1] == 'HEAD':
                    return 'a' * 40
                if str(command[-1]).endswith('^{commit}'):
                    return reviewed
                if any(str(part).endswith('sync_claude.py') for part in command):
                    return subprocess.run(command, check=True, text=True, capture_output=True).stdout.strip()
                if any(str(part).endswith('validate.py') for part in command):
                    return ''
                raise AssertionError(command)

            def load_packager(candidate):
                def build(plugin, source, root):
                    output.mkdir()
                    provenance = root / f'plugins/{plugin}/runtime/provenance.json'
                    return json.loads(provenance.read_text())
                return types.SimpleNamespace(build=build)

            with patch.object(module, 'run', side_effect=commands), \
                 patch.object(module, 'export_tree', side_effect=copy_candidate), \
                 patch.object(module, 'load_packager', side_effect=load_packager):
                with self.assertRaisesRegex(ValueError, 'appeared'):
                    module.release(ROOT, 'disq', ROOT, '9.9.9', output)
            self.assertTrue(output.is_dir())


if __name__ == '__main__':
    unittest.main()
