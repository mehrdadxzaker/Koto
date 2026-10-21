"""A supervised proposal cannot acquire autonomous execution or routing authority."""
from copy import deepcopy
import json
import os
import subprocess
import sys
import unittest

from tests import test_execution_destination_workflow as workflow


class ProposalAdmissionWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.fixture = workflow.ExecutionDestinationWorkflowTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.environment['KOTO_HISTORY_HOME'] = str(self.fixture.root / 'history')
        self.body = {'model': 'local-code', 'input': 'Fix the arithmetic function in this Python code. Propose a patch.',
                     'max_output_tokens': 8, 'reasoning': {'effort': 'low'}, 'stream': False, 'store': False}
        self.headers = {'X-Hormuz-Routing-Mode': 'local_only', 'X-Hormuz-Task-Selection': 'proposal'}

    def configuration(self, local, cloud):
        value = self.fixture.admission_configuration(local, cloud, mode='auto')
        value['model_routes']['local-code']['capabilities'] += ['codex_http', 'codex_http_0160', 'codex_llama_v1']
        value['route_admission']['local_routes']['local-code']['task_types'] = ['code_change']
        value['ai_work'] = {'enabled': True, 'cache_enabled': True,
                            'database': str(self.fixture.root / 'work.sqlite3')}
        return value

    def test_explicit_proposals_are_fresh_and_bypass_selection_learning_and_answer_reuse(self):
        with workflow.provider('Suggested patch.') as (local, calls), workflow.provider('CLOUD') as (cloud, cloud_calls), \
                workflow.provider('AVAILABLE ALTERNATE') as (alternate, alternate_calls):
            config = self.configuration(local, cloud)
            config['upstreams']['alternate'] = {'protocol': 'openai', 'base_url': alternate,
                'locality': 'local', 'authentication': 'none'}
            config['model_routes']['alternate'] = {**config['model_routes']['local-code'],
                'destination': 'alternate', 'upstream_model': 'alternate-model'}
            config['route_admission']['local_routes']['alternate'] = dict(
                config['route_admission']['local_routes']['local-code'])
            config['policies']['organization']['allowed_models'].append('alternate')
            with self.fixture.connected_client(config) as submit:
                def history(*arguments):
                    result = subprocess.run([sys.executable, '-m', 'koto', '--config',
                        str(self.fixture.root / 'gateway.json'), 'history', *arguments],
                        env={**os.environ, **self.fixture.environment}, capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    return json.loads(result.stdout)

                history('enable')
                history('learning', 'enable')
                # Real host delegations include a role/context preamble. The
                # automatic classifier correctly leaves that text unknown;
                # explicit text proposals must not depend on its task-quality gate.
                body = {**self.body, 'input': 'You are the installed local worker assisting a commercial Codex agent.\n'
                    'Task: Fix the native router storage error in this Python code. Return a proposed patch.'}
                ordinary = submit(control=True, request=body,
                    headers={**self.headers, 'X-Hormuz-Task-Selection': 'model'})
                self.assertEqual(ordinary['status'], 503, ordinary)
                self.assertEqual(calls, [])
                for _ in range(2):
                    result = submit(control=True, request=body, headers=self.headers)
                    self.assertEqual(result['status'], 200, result)
                    self.assertEqual(result['headers']['x-hormuz-task-selection'], 'proposal')
                    self.assertEqual(result['headers']['x-hormuz-work-route'], 'supervised_proposal')
                    self.assertEqual(result['headers']['x-hormuz-work-outcome'], 'unknown')
                    self.assertNotIn('x-hormuz-failover', result['headers'])
                    self.assertNotIn('x-hormuz-cache', result['headers'])
                    self.assertEqual(calls[-1]['body']['input'], body['input'])
                entries = history('list')['entries']
                self.assertEqual(len(entries), 2)
                for item in entries:
                    entry = history('show', item['id'])['entry']
                    self.assertNotIn('selection', entry)
                    self.assertEqual(entry['routing_evidence']['routing_reason'], 'supervised_proposal')
                state = submit(method='GET', path='/router/state')['body']['routes'][0]
                self.assertEqual(state['coding_readiness'], 'unknown')
                self.assertEqual(state['automatic_task_types'], [])
            self.assertEqual((len(calls), alternate_calls, cloud_calls), (2, [], []))

    def test_tools_continuations_storage_and_unknown_fields_are_rejected_before_dispatch(self):
        changes = (
            {'tools': []}, {'tool_choice': 'none'}, {'previous_response_id': None},
            {'background': False}, {'include': []}, {'instructions': 'extra control'},
            {'service_tier': 'default'}, {'input': [{'type': 'message', 'content': 'text'}]},
            {'input': ''}, {'stream': True}, {'store': True}, {'store': None},
            {'max_output_tokens': True}, {'reasoning': {'effort': []}},
            {'reasoning': {'effort': 'low', 'summary': 'auto'}},
        )
        with workflow.provider('UNUSED') as (local, calls), workflow.provider('UNUSED') as (cloud, cloud_calls), \
                self.fixture.connected_client(self.configuration(local, cloud)) as submit:
            for change in changes:
                with self.subTest(change=change):
                    result = submit(control=True, request={**self.body, **change}, headers=self.headers)
                    self.assertEqual(result['status'], 403, result)
                    self.assertEqual(result['body']['error']['code'], 'hormuz_route_invalid_proposal')
            self.assertEqual((calls, cloud_calls), ([], []))

    def test_conflicting_headers_wrong_endpoint_and_cloud_alias_cannot_enter_proposal_mode(self):
        conflicts = ({'X-Hormuz-Routing-Mode': ''}, {'X-Hormuz-Task-Selection': 'proposal,proposal'},
            {'X-Hormuz-Benchmark': '1'}, {'X-Hormuz-Work-ID': 'existing-work'},
            {'thread-id': 'existing-thread'}, {'session-id': 'existing-session'},
            {'x-codex-parent-thread-id': 'existing-parent'})
        with workflow.provider('UNUSED') as (local, calls), workflow.provider('UNUSED') as (cloud, cloud_calls), \
                self.fixture.connected_client(self.configuration(local, cloud)) as submit:
            for headers in conflicts:
                with self.subTest(headers=headers):
                    result = submit(control=True, request=self.body, headers={**self.headers, **headers})
                    self.assertNotEqual(result['status'], 200, result)
            for path in ('/responses?extra=1', '/chat/completions'):
                result = submit(control=True, request=self.body, headers=self.headers, path=path)
                self.assertEqual(result['status'], 403, result)
            result = submit(control=True, request={**self.body, 'model': 'cloud-code'}, headers=self.headers)
            self.assertEqual(result['status'], 503, result)
            self.assertEqual((calls, cloud_calls), ([], []))

    def test_proposal_selection_preserves_policy_and_output_bounds(self):
        with workflow.provider('UNUSED') as (local, calls), workflow.provider('UNUSED') as (cloud, cloud_calls):
            config = self.configuration(local, cloud)
            config['policies']['organization']['max_output_tokens'] = 100
            with self.fixture.connected_client(config) as submit:
                result = submit(control=True, request={**self.body, 'max_output_tokens': 9}, headers=self.headers)
                self.assertEqual(result['status'], 503, result)
            denied = deepcopy(config)
            denied['policies']['organization']['allowed_models'] = ['cloud-code']
            with self.fixture.connected_client(denied) as submit:
                result = submit(control=True, request=self.body, headers=self.headers)
                self.assertEqual(result['status'], 403, result)
            self.assertEqual((calls, cloud_calls), ([], []))


if __name__ == '__main__':
    unittest.main()
