"""Content-free client observations through the public diagnostic CLI."""
import json
import os
import sys
import time
import unittest

from hormuz.contracts import validate_contract
from tests import test_connected_client_lifetime_workflow as lifetime
from tests import test_execution_destination_workflow as execution


class ClientDiagnosticsWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.fixture = lifetime.ConnectedClientLifetimeWorkflowTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        value = execution.ExecutionDestinationWorkflowTests.configuration(
            self.fixture, 'http://127.0.0.1:1', 'http://127.0.0.1:2')
        self.fixture.path.write_text(json.dumps(value))
        self.settings = self.fixture.home / 'config.toml'
        self.settings.write_text('model = "PRIVATE_ORIGINAL_MODEL"\n')
        self.before_config = self.fixture.path.read_bytes()
        self.before_settings = self.settings.read_bytes()

    def diagnose(self, executable=None):
        result = self.fixture.command('diagnose', '--executable',
                                      str(executable or self.fixture.executable))
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt['schema_version'], 2)
        validate_contract(receipt)
        self.assertNotIn('PRIVATE_ORIGINAL_MODEL', result.stdout)
        self.assertEqual(self.fixture.path.read_bytes(), self.before_config)
        self.assertEqual(self.settings.read_bytes(), self.before_settings)
        self.assertEqual((receipt['model_readiness'], receipt['task_completion']),
                         ('unobserved', 'unobserved'))
        return receipt

    def executable(self, body):
        self.fixture.executable.write_text('#!' + sys.executable + '\n' + body)
        self.fixture.executable.chmod(0o700)

    def test_valid_unqualified_version_is_observed_without_admitting_the_client(self):
        (self.root / 'client-version.txt').write_text('0.999.0')
        receipt = self.diagnose()
        self.assertEqual(receipt['client_check'], {
            'schema_id': 'hormuz.client-check', 'schema_version': 1,
            'reason': 'version_unqualified', 'action': 'select_supported_client',
            'observed_version': '0.999.0'})
        self.assertEqual(receipt['client_compatibility'], 'unsupported')
        self.assertEqual(receipt['supported_client_version'], '0.160.0')
        denied = self.fixture.command('connect', '--dry-run', check=False)
        self.assertEqual(denied.returncode, 2)
        self.assertEqual(json.loads(denied.stderr)['error']['code'],
                         'connected_client_version_unsupported')
        self.assertEqual(self.settings.read_bytes(), self.before_settings)

    def test_missing_executable_is_not_reported_as_an_unsupported_version(self):
        receipt = self.diagnose(self.root / 'missing-client')
        self.assertEqual(receipt['client_compatibility'], 'unavailable')
        self.assertEqual(receipt['client_check']['reason'], 'executable_missing')
        self.assertEqual(receipt['action'], 'select_client_executable')
        self.assertIsNone(receipt['client_check']['observed_version'])

    def test_unlaunchable_executable_has_an_executable_recovery_action(self):
        self.fixture.executable.write_text('PRIVATE_INVALID_EXECUTABLE')
        receipt = self.diagnose()
        self.assertEqual(receipt['client_compatibility'], 'unavailable')
        self.assertEqual(receipt['client_check']['reason'], 'executable_unlaunchable')
        self.assertEqual(receipt['action'], 'inspect_client_executable')
        self.assertNotIn('PRIVATE_INVALID_EXECUTABLE', json.dumps(receipt))

    def test_existing_nonexecutable_path_is_distinct_from_a_missing_command(self):
        self.fixture.executable.chmod(0o600)
        receipt = self.diagnose()
        self.assertEqual(receipt['client_check']['reason'], 'executable_unlaunchable')
        self.assertEqual(receipt['action'], 'inspect_client_executable')

    def test_supported_banner_with_failed_command_is_not_admitted(self):
        self.executable('print("codex-cli 0.160.0")\nraise SystemExit(7)\n')
        receipt = self.diagnose()
        self.assertEqual(receipt['client_check']['reason'], 'version_command_failed')
        self.assertEqual(receipt['action'], 'inspect_client_version_command')
        self.assertIsNone(receipt['client_check']['observed_version'])
        denied = self.fixture.command('connect', '--dry-run', check=False)
        self.assertEqual(denied.returncode, 2)
        self.assertEqual(json.loads(denied.stderr)['error']['code'],
                         'connected_client_version_unsupported')
        self.assertEqual(self.settings.read_bytes(), self.before_settings)

    def test_oversized_version_output_is_bounded_and_not_returned(self):
        self.executable('print("PRIVATE_VERSION_OUTPUT" * 300)\n')
        receipt = self.diagnose()
        self.assertEqual(receipt['client_check']['reason'], 'version_output_too_large')
        self.assertEqual(receipt['action'], 'inspect_client_version_output')
        self.assertIsNone(receipt['client_check']['observed_version'])
        self.assertNotIn('PRIVATE_VERSION_OUTPUT', json.dumps(receipt))

    def test_version_timeout_is_distinct_and_reaps_the_owned_process(self):
        self.executable('import os, pathlib, time\n'
                        'pathlib.Path(__file__).with_name("version-pid").write_text(str(os.getpid()))\n'
                        'time.sleep(20)\n')
        started = time.monotonic()
        receipt = self.diagnose()
        self.assertLess(time.monotonic() - started, 8)
        self.assertEqual(receipt['client_check']['reason'], 'version_timeout')
        self.assertEqual(receipt['action'], 'inspect_client_process')
        self.assertIsNone(receipt['client_check']['observed_version'])
        pid = int((self.root / 'version-pid').read_text())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_eof_does_not_allow_a_hanging_version_command(self):
        self.executable('import os, time\nos.close(1)\ntime.sleep(20)\n')
        receipt = self.diagnose()
        self.assertEqual(receipt['client_check']['reason'], 'version_timeout')
        self.assertEqual(receipt['action'], 'inspect_client_process')

    def test_malformed_output_remains_content_free_and_unsupported(self):
        for body in ('print("PRIVATE_MALFORMED_BANNER")\n',
                     'import os\nos.write(1, b"codex-cli \\xff")\n',
                     'print("codex-cli 0.160.0\\nPRIVATE_EXTRA_OUTPUT")\n'):
            with self.subTest(body=body):
                self.executable(body)
                receipt = self.diagnose()
                self.assertEqual(receipt['client_check']['reason'], 'version_malformed')
                self.assertEqual(receipt['client_compatibility'], 'unsupported')
                self.assertEqual(receipt['action'], 'inspect_client_version_output')
                self.assertIsNone(receipt['client_check']['observed_version'])
                self.assertNotIn('PRIVATE_', json.dumps(receipt))

    def test_supported_versions_keep_the_existing_allowlist_and_whitespace_acceptance(self):
        for version in ('0.147.0', '0.160.0', '0.162.0-alpha.17.2'):
            with self.subTest(version=version):
                self.executable('print("  codex-cli ' + version + '  ")\n')
                receipt = self.diagnose()
                self.assertEqual(receipt['client_check']['reason'], 'version_supported')
                self.assertEqual(receipt['client_check']['observed_version'], version)
                self.assertEqual(receipt['client_compatibility'], 'supported')
                self.assertEqual(receipt['supported_client_version'], version)

    def test_omitted_executable_is_unobserved_without_running_the_client(self):
        self.executable('raise SystemExit("PRIVATE_CLIENT_WAS_RUN")\n')
        result = self.fixture.command('diagnose')
        receipt = json.loads(result.stdout)
        validate_contract(receipt)
        self.assertEqual(receipt['client_compatibility'], 'unobserved')
        self.assertEqual(receipt['client_check']['reason'], 'not_checked')
        self.assertEqual(receipt['runtime_check']['reason'], 'not_configured')
        self.assertNotIn('PRIVATE_', result.stdout)
        self.assertEqual(self.fixture.path.read_bytes(), self.before_config)
        self.assertEqual(self.settings.read_bytes(), self.before_settings)
