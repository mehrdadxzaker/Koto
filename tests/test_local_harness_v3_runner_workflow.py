"""The experiment runner cannot label an unsupported treatment as execution."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tests import test_local_harness_experiment_workflow as experiment_tests


class LocalHarnessV3RunnerTests(unittest.TestCase):
    def prepare(self, root, *, harness='v3', baseline='v2'):
        profile = json.loads((Path(__file__).parent / 'fixtures/local-setup-profile-v5.json').read_text())
        profile['model'] = 'Qwen3-14B-Q4_K_M'
        profile['capabilities'] += ['qwen_code_v1', 'qwen_code_v2']
        asset = root / 'asset'
        asset.write_bytes(b'synthetic frozen asset')
        profile['model_sha256'] = hashlib.sha256(asset.read_bytes()).hexdigest()
        path = root / 'profile.json'
        path.write_text(json.dumps(profile))
        return SimpleNamespace(output=root / 'run', profile=path, client=asset,
            runtime_archive=asset, llama=asset, model_file=asset, harness=harness,
            baseline_harness=baseline, case=['atomic-stock', 'stable-key-unique'],
            arm='adapted', episode_seconds=180)

    def test_cli_accepts_v3_as_treatment_and_as_an_explicit_baseline(self):
        tool = experiment_tests.experiment()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self.prepare(root)
            required = []
            for flag in ('output', 'profile', 'client', 'runtime-archive', 'llama', 'model-file'):
                required += ['--' + flag, str(getattr(args, flag.replace('-', '_')))]
            for selected, baseline in [('v3', 'v2'), ('v2', 'v3')]:
                with self.subTest(selected=selected, baseline=baseline), \
                     patch.object(sys, 'argv', ['compare_local_harness.py', *required,
                         '--harness', selected, '--baseline-harness', baseline]), \
                     patch.object(tool, 'Comparison') as comparison:
                    tool.main()
                    parsed = comparison.call_args.args[0]
                    self.assertEqual((parsed.harness, parsed.baseline_harness), (selected, baseline))
                    comparison.return_value.run.assert_called_once_with()

    def test_unsupported_installed_profile_is_rejected_before_a_labeled_run(self):
        tool = experiment_tests.experiment()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self.prepare(root)
            old_profiles = {'qwen_code_v1': 'qwen-code.v1', 'qwen_code_v2': 'qwen-code.v2'}
            with patch.object(tool, 'PROFILES', old_profiles):
                with self.assertRaisesRegex(ValueError, 'unsupported harness'):
                    tool.Comparison(args)
                self.assertFalse(args.output.exists())
        with tempfile.TemporaryDirectory() as directory:
            args = self.prepare(Path(directory), harness='v2', baseline='v99')
            with self.assertRaisesRegex(ValueError, 'unsupported harness'):
                tool.Comparison(args)

    def test_v3_capability_is_bound_to_setup_subject_source_and_frozen_plan(self):
        tool = experiment_tests.experiment()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = tool.Comparison(self.prepare(root))
            with patch.object(run, 'check', return_value={'exit_code': 1, 'termination': 'completed'}):
                plan = run.freeze()
            self.assertEqual(plan['harnesses'], {'baseline': 'qwen-code.v2', 'adapted': 'qwen-code.v3'})
            self.assertEqual((plan['max_episode_seconds'], plan['probe_schema_version']), (180, 5))
            self.assertEqual(len(plan['cases']), 6)
            self.assertEqual(plan['study_kind'], 'diagnostic')
            self.assertEqual(run.capabilities('baseline'), ['responses', 'text', 'codex_llama_v1', 'qwen_code_v2'])
            self.assertEqual(run.capabilities('adapted'), ['responses', 'text', 'codex_llama_v1', 'qwen_code_v3'])
            subjects = []
            # Exercise both the public setup and episode plan construction;
            # only process execution and independent-check execution are mocked.
            def cli(*arguments, **kwargs):
                if arguments[:2] == ('client', 'setup'):
                    run.config.write_text(json.dumps({'route_admission': {'mode': 'local_only'},
                        'upstreams': {'local': {'locality': 'local'}}}))
                    (run.client_home / 'config.toml').write_text('model_provider="synthetic"\n')
                    return {'connection': {'generation': 'synthetic'},
                            'configuration': {'listen_port': 1, 'runtime_port': 2}}
                if arguments[:3] == ('client', 'qualify', 'codex'):
                    if '--plan' in arguments:
                        probe = json.loads(Path(arguments[arguments.index('--plan') + 1]).read_text())
                        subjects.append(probe['subject'])
                        return {'probe_id': 'synthetic'}
                    return {'submitted_requests': 1}
                return {'routes': [{'automatic_task_types': []}]}
            run.cli = cli
            run.connect('adapted')
            declaration = json.loads((run.root / 'adapted-setup.json').read_text())
            self.assertEqual(declaration['capabilities'], run.capabilities('adapted'))
            run.server = SimpleNamespace(server_port=12345)
            def launch(case, label, **kwargs):
                if label.endswith('-capture'):
                    run.capture = {'model': tool.MODEL, 'input': [{'type': 'message',
                        'role': 'user', 'content': case['goal']}]}
                return {'client_exit_code': 0, 'termination': 'completed', 'elapsed_ms': 1,
                        'turn_completed': True, 'tool_calls': 0, 'tool_errors': 0}
            run.launch = launch
            with patch.object(run, 'check', return_value={'exit_code': 1, 'termination': 'completed'}):
                run.episode(plan['cases'][0], 'adapted', plan)
            self.assertEqual(len(subjects), 1)
            self.assertEqual(subjects[0]['capabilities'], declaration['capabilities'])
            self.assertEqual(run.rows[0]['harness'], 'qwen-code.v3')


if __name__ == '__main__':
    unittest.main()
