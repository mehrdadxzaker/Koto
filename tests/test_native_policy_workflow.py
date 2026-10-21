"""Native task secret policy at the public CLI and external client boundary."""
import json
import unittest

from tests import test_personal_native_workflow as workflow


class NativePolicyWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.task = workflow.PersonalNativeWorkflowTests()
        self.task.setUp()
        self.addCleanup(self.task.doCleanups)
        self.task.configure('http://127.0.0.1:9/v1', 'http://127.0.0.1:9/v1')

    def route(self):
        return self.task.command('chat', 'route', '--executable', str(self.task.native),
            '--client-home', str(self.task.home), '--prompt-file', str(self.task.prompt))

    def requests(self):
        path = self.task.home / 'requests.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_deny_policy_stops_a_configured_secret_before_the_native_turn(self):
        value = json.loads(self.task.path.read_text())
        value['egress_controls'] = {'secrets': {'mode': 'deny', 'builtins': False}}
        self.task.path.write_text(json.dumps(value))
        secret = self.task.environment['DESTINATION_WORKFLOW_TOKEN']
        self.task.prompt.write_text('Summarize this confidential value: ' + secret)
        completed = self.route()
        self.assertEqual([request for request in self.requests() if request.get('method') == 'turn/start'], [],
                         'Configured secret reached the native turn')
        self.assertEqual(completed.returncode, 2, completed.stderr or completed.stdout)
        error = json.loads(completed.stderr or completed.stdout)
        self.assertEqual(error['error']['code'], 'native_secret_detected')
        self.assertEqual((self.task.home / 'config.toml').read_bytes(), self.task.original)
        self.assertEqual((self.task.home / 'auth.json').read_text(), 'SYNTHETIC_NATIVE_AUTH_DO_NOT_COPY')

    def test_redact_policy_sends_only_sanitized_configured_credentials_to_the_native_turn(self):
        value = json.loads(self.task.path.read_text())
        value['upstreams']['private-api'] = {'protocol': 'openai', 'base_url': 'http://127.0.0.1:9/v1',
                                             'api_key_env': 'NATIVE_POLICY_PROVIDER_KEY'}
        value['egress_controls'] = {'secrets': {'mode': 'redact', 'builtins': True,
                                               'custom_secret_envs': ['NATIVE_POLICY_CUSTOM']}}
        self.task.environment.update(NATIVE_POLICY_PROVIDER_KEY='provider-credential-without-a-token-pattern',
                                     NATIVE_POLICY_CUSTOM='custom-protected-value')
        self.task.path.write_text(json.dumps(value))
        secrets = (self.task.environment['DESTINATION_WORKFLOW_TOKEN'],
                   self.task.environment['NATIVE_POLICY_PROVIDER_KEY'],
                   self.task.environment['NATIVE_POLICY_CUSTOM'], 'ghp_' + 'A' * 30)
        self.task.prompt.write_text('Summarize ' + ' / '.join(secrets) + '.')
        self.assertEqual(self.task.command('history', 'enable').returncode, 0)
        self.assertEqual(self.task.command('history', 'learning', 'enable').returncode, 0)
        completed = self.route()
        self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)
        turns = [request for request in self.requests() if request.get('method') == 'turn/start']
        self.assertEqual(len(turns), 1)
        sanitized = ('Summarize [REDACTED:HORMUZ_SECRET] / [REDACTED:HORMUZ_SECRET] / '
                     '[REDACTED:HORMUZ_SECRET] / [REDACTED:HORMUZ_SECRET].')
        self.assertEqual(turns[0]['params']['input'], [{'type': 'text', 'text': sanitized}])
        receipt = json.loads(completed.stdout)
        entry = json.loads(self.task.command('history', 'show', receipt['history_entry']).stdout)['entry']
        self.assertEqual(entry['request_text'], [{'role': 'user', 'text': sanitized}])
        for secret in secrets:
            self.assertNotIn(secret, json.dumps(self.requests()) + completed.stdout + completed.stderr)
        self.assertEqual((self.task.home / 'config.toml').read_bytes(), self.task.original)
        self.assertEqual((self.task.home / 'auth.json').read_text(), 'SYNTHETIC_NATIVE_AUTH_DO_NOT_COPY')

    def test_unsupported_managed_configuration_is_rejected_before_any_native_request(self):
        value = json.loads(self.task.path.read_text())
        value['policy_control'] = {'mode': 'postgresql'}
        self.task.path.write_text(json.dumps(value))
        completed = self.route()
        self.assertEqual(completed.returncode, 2, completed.stderr or completed.stdout)
        self.assertEqual(self.requests(), [])
        self.assertEqual(json.loads(completed.stderr)['error']['code'], 'native_task_unavailable')
        self.assertEqual((self.task.home / 'config.toml').read_bytes(), self.task.original)


if __name__ == '__main__':
    unittest.main()
