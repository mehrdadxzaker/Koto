"""Portable CLI entrypoints remain usable without POSIX-only OS modules."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import hormuz


class InstallPortabilityWorkflowTests(unittest.TestCase):
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
