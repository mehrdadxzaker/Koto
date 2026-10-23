"""The standalone acceptance runner retains failed owned subprocess evidence."""
import json
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

from tools.verify_bootstrap_install import run_stage


class BootstrapAcceptanceWorkflowTests(unittest.TestCase):
    def test_timeout_retains_original_output_stage_timing_and_owned_child_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = {"stages": [], "passed": False}
            command = [sys.executable, "-c", "import sys,time; "
                "print('original stdout',flush=True); print('original stderr',file=sys.stderr,flush=True); time.sleep(60)"]
            with self.assertRaises(subprocess.TimeoutExpired):
                run_stage("timed-out-stage", command, evidence=root, report=report,
                          environment={}, cwd=root, timeout=1)
            self.assertEqual((root / "timed-out-stage.stdout").read_bytes(), b"original stdout\n")
            self.assertEqual((root / "timed-out-stage.stderr").read_bytes(), b"original stderr\n")
            saved = json.loads((root / "result.json").read_text())
            self.assertFalse(saved["passed"])
            stage, = saved["stages"]
            self.assertEqual((stage["name"], stage["failure"]), ("timed-out-stage", "TimeoutExpired"))
            self.assertEqual(stage["returncode"], -signal.SIGTERM)
            self.assertGreaterEqual(stage["seconds"], 1)
