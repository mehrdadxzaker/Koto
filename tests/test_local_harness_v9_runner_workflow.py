"""The public comparison CLI accepts explicit v9 arms without starting a run."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tests import test_local_harness_experiment_workflow as experiment


class LocalHarnessV9RunnerTests(unittest.TestCase):
    def test_cli_accepts_v8_v9_pairs_and_preserves_ordinary_defaults(self):
        for selected in (('v8', 'v9'), ('v9', 'v8'), None):
            with self.subTest(selected=selected), tempfile.TemporaryDirectory() as directory:
                tool = experiment.experiment()
                root = Path(directory)
                fixture = root / 'existing-fixture'
                fixture.write_text('CLI path fixture; no executable is launched.\n')
                argv = ['compare_local_harness.py', '--output', str(root / 'run')]
                for name in ('profile', 'client', 'runtime-archive', 'llama', 'model-file'):
                    argv += ['--' + name, str(fixture)]
                if selected:
                    argv += ['--baseline-harness', selected[0], '--harness', selected[1],
                             '--episode-seconds', '180', '--reasoning-effort', 'low']
                with patch.object(tool.sys, 'argv', argv), patch.object(tool, 'Comparison') as run:
                    tool.main()
                args = run.call_args.args[0]
                self.assertEqual((args.baseline_harness, args.harness), selected or ('none', 'v1'))
                self.assertEqual((args.episode_seconds, args.reasoning_effort), (180, 'low') if selected else (90, 'none'))
                self.assertEqual(args.arm, 'both')
                run.return_value.run.assert_called_once_with()
                self.assertFalse(args.output.exists())


if __name__ == '__main__':
    unittest.main()
