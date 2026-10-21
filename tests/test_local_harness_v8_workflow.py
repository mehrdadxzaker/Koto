"""The script helper keeps native execution and coding admission boundaries."""
from copy import deepcopy
import json
from pathlib import Path
import shlex
import unittest

from hormuz.codex_llama import CodexLlamaRequest
from hormuz.config import ConfigError, GatewayConfig
from hormuz.contracts import validate_contract
from hormuz.server import GatewayRequestHandler
from tests import test_codex_app_workflow as app
from tests import test_coding_output_workflow as coding
from tests import test_connected_client_lifetime_workflow as lifetime
from tests import test_execution_destination_workflow as destination


class LocalHarnessV8WorkflowTests(unittest.TestCase):
    def test_preview_live_script_translation_and_native_failure_history_match(self):
        script = '''import copy
from saved_module import apply_offsets
state = [10]
before = copy.deepcopy(state)
try:
    apply_offsets(state, [-4, -11])
except ValueError:
    pass
else:
    raise AssertionError("expected rejection")
assert state == before
'''
        self._script_roundtrip(script)

    def test_script_syntax_is_preserved_and_host_error_returns_without_fabricated_result(self):
        self._script_roundtrip('try: invalid(', host_output='SyntaxError: invalid syntax\n')

    def _script_roundtrip(self, script, host_output='AssertionError: expected unchanged state\n'):
        from hormuz.local_python_script import compile_script
        fixture = app.CodexAppWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        native = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        thread = '11111111-1111-4111-8111-111111111111'
        request = {'input': [{'type': 'message', 'role': 'user', 'content': 'Summarize the fixture.'}],
            'instructions': 'Preserve the original host instructions, tools and permissions.',
            'tools': [native['declarations']['exec_command']], 'tool_choice': 'auto',
            'client_metadata': {'thread_id': thread, 'session_id': thread}, 'reasoning': {'effort': 'none'}}
        headers = {'thread-id': thread, 'session-id': thread}
        expected_first = CodexLlamaRequest(request, harness='qwen-code.v8').value
        derived = [tool for tool in expected_first['tools']
                   if 'script' in tool.get('parameters', {}).get('properties', {})]
        self.assertEqual(len(derived), 1)
        upstream_call = {'type': 'function_call', 'id': 'fc-script', 'call_id': 'script-call',
                         'name': derived[0]['name'], 'arguments': json.dumps({'script': script})}
        with destination.provider('LOCAL', response_fields={'output': [upstream_call]}) as (local, requests), \
             destination.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            value = fixture.configuration(local, cloud)
            route = value['model_routes']['local-code']
            route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
            route['capabilities'].append('qwen_code_v8')
            value['ai_work'] = {'enabled': True, 'tool_capable_aliases': ['local-code'],
                                'database': str(fixture.fixture.root / 'work.sqlite3')}
            path = fixture.fixture.root / 'v8-script.json'
            path.write_text(json.dumps(value))
            selected = GatewayConfig.load(path, environ=fixture.fixture.environment).model_routes['local-code']
            with fixture.fixture.connected_client(value) as submit:
                first = submit(headers=headers, request=request)
                self.assertEqual(first['status'], 200, first)
                call = first['body']['output'][0]
                self.assertEqual((call['name'], call.get('namespace')), ('exec_command', None))
                self.assertEqual(json.loads(call['arguments']), {'cmd': compile_script(script)})
                self.assertEqual(shlex.split(json.loads(call['arguments'])['cmd'])[2], script)
                # A mock host failure is transport evidence only. Actual native
                # execution is covered by a separate zero-inference control.
                result = deepcopy(native['cases']['exec_failure']['result'])
                result['call_id'] = call['call_id']
                result['output'] = result['output'].split('Output:\n')[0] + 'Output:\n' + host_output
                continued = deepcopy(request)
                continued['input'] += [call, result]
                original = deepcopy(continued)
                expected = CodexLlamaRequest(continued, harness='qwen-code.v8').value
                preview = json.loads(GatewayRequestHandler._provider_body(continued, selected))
                for key in ('instructions', 'input', 'tools'):
                    self.assertEqual(preview[key], expected[key])
                self.assertEqual(preview['tool_choice'], request['tool_choice'])
                self.assertEqual(len([tool for tool in preview['tools']
                    if 'script' in tool.get('parameters', {}).get('properties', {})]), 1)
                baseline = CodexLlamaRequest(continued).value['input']
                self.assertEqual(len(preview['input'][:-1]), len(baseline))
                for actual, before in zip(preview['input'][:-1], baseline):
                    if actual.get('type') == 'function_call':
                        self.assertEqual(json.loads(actual['arguments']), json.loads(before['arguments']))
                        self.assertEqual({k: v for k, v in actual.items() if k != 'arguments'},
                                         {k: v for k, v in before.items() if k != 'arguments'})
                    else:
                        self.assertEqual(actual, before)
                self.assertEqual(preview['input'][-2]['output'], result['output'])
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

    def test_v8_config_requires_exact_local_native_model_and_exclusive_profile(self):
        fixture = app.CodexAppWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        with destination.provider('UNUSED_LOCAL') as (local, requests), \
             destination.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            original = fixture.configuration(local, cloud)
            route = original['model_routes']['local-code']
            route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
            route['capabilities'].append('qwen_code_v8')
            path = fixture.fixture.root / 'v8.json'
            path.write_text(json.dumps(original))
            self.assertIn('qwen_code_v8', GatewayConfig.load(path,
                environ=fixture.fixture.environment).model_routes['local-code'].capabilities)
            for invalid in ['cloud', 'wrong_model', 'missing_transport', *('v' + str(i) for i in range(1, 8))]:
                with self.subTest(invalid=invalid):
                    value = deepcopy(original)
                    route = value['model_routes']['local-code']
                    if invalid == 'cloud': route['destination'] = 'openai'
                    elif invalid == 'wrong_model': route['upstream_model'] = 'another-model'
                    elif invalid == 'missing_transport': route['capabilities'].remove('codex_llama_v1')
                    else: route['capabilities'].append('qwen_code_' + invalid)
                    path.write_text(json.dumps(value))
                    with self.assertRaisesRegex(ConfigError, 'Qwen'):
                        GatewayConfig.load(path, environ=fixture.fixture.environment)
            self.assertEqual((requests, cloud_requests), ([], []))

    def test_setup_keeps_ordinary_coding_blocked_and_restores_client_settings(self):
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
                capabilities=value['model_routes']['local-code']['capabilities'] + ['qwen_code_v8'],
                task_types=['code_change'])
            validate_contract(profile)
            path.write_text(json.dumps(profile))
            self.addCleanup(lambda: f.command('disconnect', check=False))
            f.command('setup', *options)
            selected = GatewayConfig.load(f.path, environ=f.environment).model_routes['Qwen3-14B-Q4_K_M']
            self.assertIn('qwen_code_v8', selected.capabilities)
            self.assertFalse(any('qwen_code_v' + str(i) in selected.capabilities for i in range(1, 8)))
            state = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((state['coding_readiness'], state['automatic_task_types']), ('unknown', []))
            self.assertEqual(f.client('code-change')['status'], 503)
            self.assertFalse((engine / 'inference-count').exists())
            f.command('disconnect')
            self.assertEqual(f.client('inspect')['model'], 'original-model')
            self.assertEqual(cloud_requests, [])

    def test_old_profile_evidence_cannot_authorize_v8_or_execute_engine(self):
        for previous in ('qwen_code_v' + str(i) for i in range(1, 8)):
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
                    route['capabilities'].append('qwen_code_v8')
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
