"""Portable CLI entrypoints remain usable without POSIX-only OS modules."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

import hormuz
from tools.verify_portable_install import run_command


class InstallPortabilityWorkflowTests(unittest.TestCase):
    def test_verification_timeout_stops_the_owned_descendant_before_it_can_write(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'surviving-child'
            descendant = (f'import time; from pathlib import Path; time.sleep(2); '
                          f'Path({str(marker)!r}).write_text("outlived the verifier")')
            parent = ('import subprocess,sys,time; '
                      f'subprocess.Popen([sys.executable,"-c",{descendant!r}]); '
                      'print("descendant started",flush=True); time.sleep(60)')
            with self.assertRaises(subprocess.TimeoutExpired) as caught:
                run_command([sys.executable, '-c', parent], cwd=directory,
                            environment=os.environ.copy(), timeout=1)
            output = caught.exception.output or b''
            if isinstance(output, bytes):
                output = output.decode()
            self.assertIn('descendant started', output)
            time.sleep(2.2)
            self.assertFalse(marker.exists(), 'The timed-out verification left its child running')

    def test_cli_help_is_available_on_a_host_without_pwd(self):
        with tempfile.TemporaryDirectory() as directory:
            environment = {**os.environ,
                "PYTHONPATH": str(Path(hormuz.__file__).resolve().parent.parent),
                "PYTHONDONTWRITEBYTECODE": "1"}
            result = subprocess.run([sys.executable, "-c",
                "import sys; sys.modules['pwd'] = None; "
                "from hormuz.cli import main; raise SystemExit(main(['--help']))"],
                cwd=directory, env=environment, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("usage: koto ", result.stdout)
            self.assertIn("init", result.stdout)
