"""Recoverable check feedback retains destination and coding-evidence bounds."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz.codex_llama import CodexLlamaRequest
from hormuz.config import ConfigError, GatewayConfig
from hormuz.contracts import validate_contract
from hormuz.server import GatewayRequestHandler
from tests import test_codex_app_workflow as app
from tests import test_coding_output_workflow as coding
from tests import test_connected_client_lifetime_workflow as lifetime
from tests import test_execution_destination_workflow as destination


class LocalHarnessV7WorkflowTests(unittest.TestCase):
    def test_provider_preview_and_live_append_the_same_derived_helper_without_changing_native_prefix(self):
        checks = {'module_path': 'offsets.py', 'function': 'apply_offsets',
            'cases': [{'args': [[10], [-4]], 'expected': [6], 'same_as_arg': 0},
                      {'args': [[10], [-11]], 'raises': 'ValueError', 'unchanged_args': [0]}],
            'atomic_batch': {'argument': 1, 'unchanged_args': [0]}}
        self._derived_provider_roundtrip(checks)

    def test_semantic_input_error_becomes_existing_native_command_and_failure_history_survives(self):
        checks = {'module_path': 'offsets.py', 'function': 'apply_offsets',
            'cases': [{'args': [[10], [-4]], 'expected': [6], 'raises': 'ValueError'}]}
        self._derived_provider_roundtrip(checks, expected_input_error=True)

    def _derived_provider_roundtrip(self, checks, *, expected_input_error=False):
        from hormuz.local_python_checks import compile_feedback_checks
        fixture = app.CodexAppWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        native = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        tool = native['declarations']['exec_command']
        thread = '11111111-1111-4111-8111-111111111111'
        request = {'input': [{'type': 'message', 'role': 'user', 'content': 'Summarize the fixture.'}],
            'instructions': 'Keep existing host instructions, tools and permissions.',
            'tools': [tool],
            'client_metadata': {'thread_id': thread, 'session_id': thread},
            'reasoning': {'effort': 'none'}}
        headers = {'thread-id': thread, 'session-id': thread}
        expected_first = CodexLlamaRequest(request, harness='qwen-code.v7').value
        derived = [decl for decl in expected_first['tools']
                   if 'checks' in decl.get('parameters', {}).get('properties', {})]
        self.assertEqual(len(derived), 1)
        helper = derived[0]['name']
        upstream_call = {'type': 'function_call', 'id': 'fc-semantic', 'call_id': 'semantic-call',
                         'name': helper, 'arguments': json.dumps({'checks': checks})}
        with destination.provider('LOCAL', response_fields={'output': [upstream_call]}) as (local, requests), \
             destination.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            value = fixture.configuration(local, cloud)
            route = value['model_routes']['local-code']
            route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
            route['capabilities'].append('qwen_code_v7')
            value['ai_work'] = {'enabled': True, 'tool_capable_aliases': ['local-code'],
                                'database': str(fixture.fixture.root / 'work.sqlite3')}
            path = fixture.fixture.root / 'v7-semantic.json'
            path.write_text(json.dumps(value))
            selected = GatewayConfig.load(path, environ=fixture.fixture.environment).model_routes['local-code']
            with fixture.fixture.connected_client(value) as submit:
                first = submit(headers=headers, request=request)
                self.assertEqual(first['status'], 200, first)
                call = first['body']['output'][0]
                self.assertEqual((call['name'], call.get('namespace')), ('exec_command', None))
                self.assertEqual(json.loads(call['arguments']), {'cmd': compile_feedback_checks(checks)})
                self.assertNotIn('checks', json.loads(call['arguments']))
                result = deepcopy(native['cases']['exec_success']['result'])
                if expected_input_error:
                    self.assertIn('KOTO_CHECK_INPUT_ERROR expected_xor_raises_required',
                                  json.loads(call['arguments'])['cmd'])
                    self.assertNotIn('offsets.py', json.loads(call['arguments'])['cmd'])
                    # Mock host feedback uses the pinned native envelope shape;
                    # actual exit2 is proved by the separate native control.
                    result = deepcopy(native['cases']['exec_failure']['result'])
                    result['output'] = result['output'].replace('with code 1\n', 'with code 2\n').split('Output:\n')[0] + (
                        'Output:\nKOTO_CHECK_INPUT_ERROR expected_xor_raises_required\n')
                result['call_id'] = call['call_id']
                continued = deepcopy(request)
                continued['input'] += [call, result]
                original = deepcopy(continued)
                expected = CodexLlamaRequest(continued, harness='qwen-code.v7').value
                preview = json.loads(GatewayRequestHandler._provider_body(continued, selected))
                for key in ('instructions', 'input', 'tools'):
                    self.assertEqual(preview[key], expected[key])
                self.assertEqual(preview.get('tool_choice'), request.get('tool_choice'))
                self.assertEqual(len([decl for decl in preview['tools']
                    if 'checks' in decl.get('parameters', {}).get('properties', {})]), 1)
                prefix = preview['input'][:-1]
                baseline = CodexLlamaRequest(continued).value['input']
                self.assertEqual(len(prefix), len(baseline))
                for actual, before in zip(prefix, baseline):
                    if actual.get('type') == 'function_call':
                        self.assertEqual(json.loads(actual['arguments']), json.loads(before['arguments']))
                        self.assertEqual({key: val for key, val in actual.items() if key != 'arguments'},
                                         {key: val for key, val in before.items() if key != 'arguments'})
                    else:
                        self.assertEqual(actual, before)
                self.assertEqual(prefix[-1]['output'], result['output'])
                self.assertEqual(preview['input'][-1]['role'], 'developer')
                second = submit(headers=headers, request=continued)
                self.assertEqual(second['status'], 200, second)
                self.assertEqual(second['headers']['x-hormuz-routing-reason'], 'session_affinity')
                self.assertEqual(continued, original)
                state = submit(method='GET', path='/router/state')['body']['routes'][0]
                self.assertNotIn('code_change', state['automatic_task_types'])
            self.assertEqual(len(requests), 2)
            for key in ('instructions', 'input', 'tools'):
                self.assertEqual(requests[1]['body'][key], preview[key])
            self.assertEqual(cloud_requests, [])

    def test_v7_config_requires_the_exact_local_native_model_and_one_profile(self):
        fixture = app.CodexAppWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        with destination.provider('UNUSED_LOCAL') as (local, requests), \
             destination.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            original = fixture.configuration(local, cloud)
            route = original['model_routes']['local-code']
            route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
            route['capabilities'].append('qwen_code_v7')
            path = fixture.fixture.root / 'v7.json'
            path.write_text(json.dumps(original))
            self.assertIn('qwen_code_v7', GatewayConfig.load(path,
                environ=fixture.fixture.environment).model_routes['local-code'].capabilities)
            for invalid in ['cloud', 'wrong_model', 'missing_transport', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6']:
                with self.subTest(invalid=invalid):
                    value = deepcopy(original)
                    route = value['model_routes']['local-code']
                    if invalid == 'cloud':
                        route['destination'] = 'openai'
                    elif invalid == 'wrong_model':
                        route['upstream_model'] = 'another-model'
                    elif invalid == 'missing_transport':
                        route['capabilities'].remove('codex_llama_v1')
                    else:
                        route['capabilities'].append('qwen_code_' + invalid)
                    path.write_text(json.dumps(value))
                    with self.assertRaisesRegex(ConfigError, 'Qwen'):
                        GatewayConfig.load(path, environ=fixture.fixture.environment)
            self.assertEqual((requests, cloud_requests), ([], []))

    def test_public_setup_accepts_the_explicit_v7_profile_without_qualifying_coding(self):
        fixture = coding.CodingOutputWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        f = fixture.fixture
        with lifetime.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            value, engine, _ = fixture.prepare(cloud)
            options = f.local_setup_options(value)
            path = Path(options[1])
            profile = json.loads(path.read_text())
            profile.update(schema_version=5, client_version='0.160.0', coding_evidence=None,
                model='Qwen3-14B-Q4_K_M', max_request_bytes=65536, max_output_tokens=2048,
                capabilities=value['model_routes']['local-code']['capabilities'] + ['qwen_code_v7'],
                task_types=['code_change'])
            validate_contract(profile)
            path.write_text(json.dumps(profile))
            self.addCleanup(lambda: f.command('disconnect', check=False))
            f.command('setup', *options)
            configured = GatewayConfig.load(f.path, environ=f.environment)
            selected = configured.model_routes['Qwen3-14B-Q4_K_M']
            self.assertIn('qwen_code_v7', selected.capabilities)
            self.assertFalse(any('qwen_code_v' + str(i) in selected.capabilities for i in range(1, 7)))
            state = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((state['coding_readiness'], state['automatic_task_types']), ('unknown', []))
            self.assertEqual(f.client('code-change')['status'], 503)
            self.assertFalse((engine / 'inference-count').exists())
            f.command('disconnect')
            self.assertEqual(f.client('inspect')['model'], 'original-model')
            self.assertEqual(cloud_requests, [])

    def test_previous_harness_evidence_including_v6_cannot_authorize_v7_coding(self):
        for previous in ('qwen_code_v1', 'qwen_code_v2', 'qwen_code_v3', 'qwen_code_v4', 'qwen_code_v5', 'qwen_code_v6'):
            with self.subTest(previous=previous):
                fixture = coding.CodingOutputWorkflowTests()
                fixture.setUp()
                self.addCleanup(fixture.doCleanups)
                f = fixture.fixture
                with lifetime.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
                    value, engine, request = fixture.prepare(cloud)
                    route = value['model_routes']['local-code']
                    route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
                    route['capabilities'].append(previous)
                    evidence = deepcopy(fixture.evidence(value, request))
                    validate_contract(evidence)
                    route['capabilities'].remove(previous)
                    route['capabilities'].append('qwen_code_v7')
                    value['route_admission']['local_routes']['local-code']['coding_evidence'] = evidence
                    f.path.write_text(json.dumps(value))
                    self.addCleanup(lambda f=f: f.command('disconnect', check=False))
                    f.command('connect')
                    state = json.loads(f.command('status', '--routing').stdout)['routes'][0]
                    self.assertEqual((state['coding_readiness'], state['automatic_task_types']), ('subject_mismatch', []))
                    self.assertEqual(f.client('code-change')['status'], 503)
                    self.assertFalse((engine / 'inference-count').exists())
                    f.command('disconnect')
                    self.assertEqual(cloud_requests, [])


if __name__ == '__main__':
    unittest.main()
