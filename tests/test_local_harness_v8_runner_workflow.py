"""Native reasoning is an explicit recorded experiment control, never a setting edit."""
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tests import test_local_harness_experiment_workflow as experiment
from tests import test_local_harness_v5_runner_workflow as runner


class LocalHarnessV8RunnerTests(unittest.TestCase):
    def test_selected_and_default_effort_reach_native_client_and_frozen_plan(self):
        for effort in ('none', 'low'):
            with self.subTest(effort=effort), tempfile.TemporaryDirectory() as directory:
                tool = experiment.experiment()
                args = runner.LocalHarnessV5RunnerTests().prepare(Path(directory), harness='v8')
                if effort != 'none':
                    args.reasoning_effort = effort
                run = tool.Comparison(args)
                with patch.object(run, 'check', return_value={'exit_code': 1, 'termination': 'completed'}):
                    plan = run.freeze()
                self.assertEqual(plan['native_reasoning_effort'], effort)
                process = SimpleNamespace(returncode=0, wait=lambda **_: 0)
                with patch.object(tool.subprocess, 'Popen', return_value=process) as spawn, \
                     patch.object(tool, 'stop'):
                    run.launch({'goal': 'Repair the saved function.'}, 'controlled')
                command = spawn.call_args.args[0]
                self.assertIn('model_reasoning_effort="' + effort + '"', command)
                self.assertIn('model_reasoning_summary="none"', command)
                self.assertEqual(plan['max_episode_seconds'], 180)
                self.assertEqual(plan['max_requests'], 16)

    def test_invalid_effort_is_rejected_before_creating_experiment_files(self):
        tool = experiment.experiment()
        with tempfile.TemporaryDirectory() as directory:
            args = runner.LocalHarnessV5RunnerTests().prepare(Path(directory), harness='v8')
            args.reasoning_effort = 'unknown'
            with self.assertRaisesRegex(ValueError, 'reasoning effort'):
                tool.Comparison(args)
            self.assertFalse(args.output.exists())


if __name__ == '__main__':
    unittest.main()
