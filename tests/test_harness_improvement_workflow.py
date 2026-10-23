"""The installed public CLI produces a private, reproducible review bundle."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stderr, redirect_stdout
import io

import hormuz
from hormuz.cli import main
from hormuz.harness_improvement import ImprovementError, build_proposal, write_bundle
from tests.test_harness_improvement_fast import encoded, trace


class HarnessImprovementWorkflowTests(unittest.TestCase):
    def test_public_command_has_no_network_or_process_execution_and_cleans_partial_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = root / 'failed.json'
            evidence.write_bytes(encoded(trace()))
            output = root / 'candidate'
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')), \
                    patch.object(subprocess, 'Popen', side_effect=AssertionError('process forbidden')), \
                    redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(main(['harness', 'improve', '--evidence', str(evidence),
                                       '--output', str(output)]), 0, stderr.getvalue())
            self.assertEqual(json.loads(stdout.getvalue())['execution'], {'model_requests': 0, 'commands': 0})
            broken = root / 'partial'
            original_open = os.open

            def fail_one_file(path, *args, **kwargs):
                if Path(path).name == 'candidate-guidance.txt':
                    raise OSError('synthetic disk failure')
                return original_open(path, *args, **kwargs)

            with patch.object(os, 'open', side_effect=fail_one_file), self.assertRaises(ImprovementError):
                write_bundle(broken, build_proposal([evidence.read_bytes()]))
            self.assertFalse(broken.exists())

    def test_cli_preserves_sources_configuration_and_qualification_and_detects_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            normal = root / 'normal-codex'
            normal.mkdir()
            config = normal / 'config.toml'
            config.write_text('model = "keep-my-model"\n')
            marker = root / 'must-not-execute'
            value = trace()
            value['native_events'][0]['item']['command'] = f'touch {marker}'
            evidence = root / 'failed.json'
            evidence.write_bytes(encoded(value))
            frozen = hashlib.sha256(evidence.read_bytes()).hexdigest()
            before = config.read_bytes()
            output = root / 'candidate'
            environment = {**os.environ, 'CODEX_HOME': str(normal), 'KOTO_CONFIG': str(root / 'absent.json'),
                           'PYTHONPATH': str(Path(hormuz.__file__).resolve().parents[1])}

            def command(*args):
                return subprocess.run([sys.executable, '-m', 'koto', 'harness', *args],
                    cwd=root, env=environment, capture_output=True, text=True, timeout=15)

            result = command('improve', '--evidence', str(evidence), '--output', str(output))
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report['execution'], {'model_requests': 0, 'commands': 0})
            self.assertEqual(report['qualification'], 'unqualified')
            self.assertEqual(set(path.name for path in output.iterdir()), {
                'proposal.json', 'base-guidance.txt', 'candidate-guidance.txt', 'candidate.patch', 'EXPERIENCE.md'})
            self.assertIn('declared interpreter', (output / 'candidate-guidance.txt').read_text())
            self.assertIn('--- base-guidance.txt', (output / 'candidate.patch').read_text())
            if os.name != 'nt':
                self.assertEqual(output.stat().st_mode & 0o777, 0o700)
                self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in output.iterdir()))
            verified = command('verify', '--evidence', str(evidence), '--bundle', str(output))
            self.assertEqual(verified.returncode, 0, verified.stderr)
            self.assertEqual(json.loads(verified.stdout), report)
            existing = command('improve', '--evidence', str(evidence), '--output', str(output))
            self.assertEqual(existing.returncode, 2)
            self.assertEqual(json.loads(existing.stderr)['error']['code'], 'output_exists')
            (output / 'candidate-guidance.txt').write_text('tampered')
            tampered = command('verify', '--evidence', str(evidence), '--bundle', str(output))
            self.assertEqual(tampered.returncode, 2)
            self.assertEqual(json.loads(tampered.stderr)['error']['code'], 'bundle_mismatch')
            self.assertEqual(config.read_bytes(), before)
            self.assertEqual(hashlib.sha256(evidence.read_bytes()).hexdigest(), frozen)
            self.assertFalse(marker.exists())
            self.assertEqual(set(normal.iterdir()), {config})

    def test_bad_inputs_never_create_output_and_source_edits_invalidate_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = root / 'failed.json'
            output = root / 'candidate'
            environment = {**os.environ, 'KOTO_CONFIG': str(root / 'missing.json'),
                           'PYTHONPATH': str(Path(hormuz.__file__).resolve().parents[1])}

            def command(*args):
                return subprocess.run([sys.executable, '-m', 'koto', 'harness', *args],
                    cwd=root, env=environment, capture_output=True, text=True, timeout=15)

            evidence.write_text('{"password": "DO_NOT_ECHO"}')
            invalid = command('improve', '--evidence', str(evidence), '--output', str(output))
            self.assertEqual(invalid.returncode, 2)
            self.assertNotIn('DO_NOT_ECHO', invalid.stderr + invalid.stdout)
            self.assertFalse(output.exists())
            malformed = trace()
            malformed['native_events'][0]['item']['command'] = '\ud800'
            evidence.write_bytes(encoded(malformed))
            refused = command('improve', '--evidence', str(evidence), '--output', str(output))
            self.assertEqual(refused.returncode, 2)
            self.assertEqual(json.loads(refused.stderr)['error']['code'], 'invalid_evidence')
            self.assertFalse(output.exists())
            evidence.write_bytes(encoded(trace()))
            self.assertEqual(command('improve', '--evidence', str(evidence), '--output', str(output)).returncode, 0)
            evidence.write_bytes(encoded({**trace(), 'case_id': 'changed-source'}))
            changed = command('verify', '--evidence', str(evidence), '--bundle', str(output))
            self.assertEqual(changed.returncode, 2)
            self.assertEqual(json.loads(changed.stderr)['error']['code'], 'bundle_mismatch')

    @unittest.skipIf(os.name == 'nt', 'POSIX symlink and FIFO behavior')
    def test_links_and_nonregular_evidence_cannot_escape_or_block_the_command(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'failed.json'
            source.write_bytes(encoded(trace()))
            link = root / 'linked.json'
            link.symlink_to(source)
            fifo = root / 'pipe'
            os.mkfifo(fifo)
            for evidence in (link, fifo, root):
                with self.subTest(evidence=evidence), redirect_stderr(io.StringIO()), redirect_stdout(io.StringIO()):
                    self.assertEqual(main(['harness', 'improve', '--evidence', str(evidence),
                                           '--output', str(root / 'refused')]), 2)
                self.assertFalse((root / 'refused').exists())
            output = root / 'bundle'
            with redirect_stdout(io.StringIO()):
                self.assertEqual(main(['harness', 'improve', '--evidence', str(source), '--output', str(output)]), 0)
            base = output / 'base-guidance.txt'
            base.unlink()
            base.symlink_to(source)
            with redirect_stderr(io.StringIO()), redirect_stdout(io.StringIO()):
                self.assertEqual(main(['harness', 'verify', '--evidence', str(source), '--bundle', str(output)]), 2)


if __name__ == '__main__':
    unittest.main()
