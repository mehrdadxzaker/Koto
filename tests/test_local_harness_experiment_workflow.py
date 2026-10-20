"""The maintainer comparison retains failures and starts each episode clean."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch


def experiment():
    path = Path(__file__).resolve().parents[1] / 'tools/compare_local_harness.py'
    spec = importlib.util.spec_from_file_location('local_harness_comparison', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LocalHarnessExperimentTests(unittest.TestCase):
    def test_rejected_native_patches_are_retained_even_without_file_change_events(self):
        tool = experiment()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'runs').mkdir()
            run = tool.Comparison.__new__(tool.Comparison)
            run.root, run.project, run.env = root, root, {}
            run.args = SimpleNamespace(client=Path('/synthetic/codex'))
            def process(*args, **kwargs):
                kwargs['stdout'].write('{"type":"turn.failed"}\n')
                kwargs['stderr'].write('\n'.join(json.loads((Path(__file__).parent /
                    'fixtures/codex-0160-rejected-patches.json').read_text())) + '\n')
                return SimpleNamespace(returncode=1, wait=lambda **kwargs: 1)
            with patch.object(tool.subprocess, 'Popen', side_effect=process), patch.object(tool, 'stop'):
                result = run.launch({'goal': 'Fix the Python function.'}, 'synthetic')
            self.assertEqual(result['tool_errors'], 2)
            self.assertIn('invalid hunk at line 4', result['rejected_native_patches'][0])
            self.assertIn('Failed to find context', result['rejected_native_patches'][1])

    def test_selected_harness_is_bound_to_setup_and_frozen_diagnostic_scope(self):
        tool = experiment()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = json.loads((Path(__file__).parent / 'fixtures/local-setup-profile-v5.json').read_text())
            fixture['model'] = tool.MODEL
            fixture['capabilities'].append('qwen_code_v1')
            asset = root / 'asset'
            asset.write_bytes(b'synthetic frozen asset')
            fixture['model_sha256'] = hashlib.sha256(asset.read_bytes()).hexdigest()
            profile = root / 'profile.json'
            profile.write_text(json.dumps(fixture))
            args = SimpleNamespace(output=root / 'run', profile=profile, client=asset,
                runtime_archive=asset, llama=asset, model_file=asset, harness='v2',
                baseline_harness='v1', case=['atomic-stock', 'stable-key-unique'], arm='adapted')
            run = tool.Comparison(args)
            with patch.object(run, 'check', return_value={'exit_code': 1, 'termination': 'completed'}):
                plan = run.freeze()
            self.assertEqual(plan['harnesses'], {'baseline': 'qwen-code.v1', 'adapted': 'qwen-code.v2'})
            self.assertEqual(plan['study_kind'], 'diagnostic')
            self.assertEqual(len(plan['cases']), 6)
            self.assertEqual(plan['order'], [{'arm': 'adapted',
                'case_ids': ['atomic-stock', 'stable-key-unique']}])
            self.assertEqual(run.capabilities('baseline')[-1], 'qwen_code_v1')
            self.assertNotIn('qwen_code_v2', run.capabilities('baseline'))
            self.assertEqual(run.capabilities('adapted')[-1], 'qwen_code_v2')
            self.assertNotIn('qwen_code_v1', run.capabilities('adapted'))
            # The public setup call receives exactly the same selected envelope
            # used for the probe subject; the CLI is mocked, not the selector.
            def cli(*arguments, **kwargs):
                if arguments[:2] == ('client', 'setup'):
                    run.config.write_text(json.dumps({'route_admission': {'mode': 'local_only'},
                        'upstreams': {'local': {'locality': 'local'}}}))
                    (run.client_home / 'config.toml').write_text('model_provider="synthetic"\n')
                    return {'connection': {'generation': 'synthetic'},
                            'configuration': {'listen_port': 1, 'runtime_port': 2}}
                return {'routes': [{'automatic_task_types': []}]}
            run.cli = cli
            run.connect('adapted')
            declaration = json.loads((run.root / 'adapted-setup.json').read_text())
            self.assertEqual(declaration['capabilities'], run.capabilities('adapted'))

    def test_longer_diagnostic_requires_explicit_profiles_and_new_probe_envelope(self):
        tool = experiment()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            profile = json.loads((Path(__file__).parent / 'fixtures/local-setup-profile-v5.json').read_text())
            profile['model'] = tool.MODEL
            path = root / 'profile.json'
            path.write_text(json.dumps(profile))
            args = SimpleNamespace(output=root / 'rejected', profile=path, harness='v2',
                baseline_harness='none', case=None, arm='both', episode_seconds=180)
            with self.assertRaisesRegex(ValueError, 'explicit harness'):
                tool.Comparison(args)
            args.output, args.baseline_harness = root / 'accepted', 'v1'
            run = tool.Comparison(args)
            self.assertEqual((run.episode_seconds, run.probe_version), (180, 5))
            args.output, args.episode_seconds = root / 'original', 90
            original = tool.Comparison(args)
            self.assertEqual((original.episode_seconds, original.probe_version), (90, 4))

    def test_next_episode_cannot_inherit_authored_tests_or_follow_directory_links(self):
        tool = experiment()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = root / 'project'
            project.mkdir()
            (project / 'solution.py').write_text('changed')
            (project / 'test_previous.py').write_text('previous model context')
            (project / '__pycache__').mkdir()
            (project / '__pycache__/cached.pyc').write_bytes(b'old bytecode')
            outside = root / 'outside'
            outside.mkdir()
            (outside / 'keep').write_text('preserve')
            (project / 'linked').symlink_to(outside, target_is_directory=True)
            tool.reset_project(project, 'def repaired(): pass\n')
            self.assertEqual([path.name for path in project.iterdir()], ['solution.py'])
            self.assertEqual((project / 'solution.py').read_text(), 'def repaired(): pass\n')
            self.assertEqual((outside / 'keep').read_text(), 'preserve')

    @unittest.skipUnless(sys.platform == 'darwin', 'Real macOS sandbox checker')
    def test_checker_timeout_deleted_source_and_runtime_errors_are_retained(self):
        tool = experiment()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'solution.py'
            source.write_text('value = 1\n')
            checks = root / 'checks.py'
            checks.write_text('import time\ntime.sleep(10)\n')
            result = tool.independent_check(checks, source, python=sys.executable,
                                             environment=os.environ, timeout=0.2)
            self.assertEqual(result['termination'], 'timeout')
            self.assertNotEqual(result['exit_code'], 0)
            source.unlink()
            missing = tool.independent_check(checks, source, python=sys.executable, environment=os.environ)
            self.assertEqual((missing['termination'], missing['exit_code']), ('missing_source', 2))
            source.write_text('value = 1\n')
            checks.write_text('raise RuntimeError("generated code error")\n')
            error = tool.independent_check(checks, source, python=sys.executable, environment=os.environ)
            self.assertEqual(error['termination'], 'completed')
            self.assertNotEqual(error['exit_code'], 0)
            self.assertIn('generated code error', error['stderr'])


if __name__ == '__main__':
    unittest.main()
