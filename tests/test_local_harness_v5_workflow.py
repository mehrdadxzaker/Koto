"""Progress guidance retains destination and coding-evidence boundaries."""
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


class LocalHarnessV5WorkflowTests(unittest.TestCase):
    def test_native_failed_command_progress_matches_provider_preview_and_live_submission(self):
        fixture = app.CodexAppWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        native = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        failed = native['cases']['exec_failure']
        tool = native['declarations']['exec_command']
        thread = '11111111-1111-4111-8111-111111111111'
        tags = {'thread_id': thread, 'session_id': thread}
        headers = {'thread-id': thread, 'session-id': thread}
        request = {'input': [{'type': 'message', 'role': 'user', 'content': 'Summarize the fixture.'}],
            'instructions': 'Keep existing host instructions, tools and permissions.',
            'tools': [tool], 'client_metadata': tags, 'reasoning': {'effort': 'none'}}
        with destination.provider('LOCAL', response_fields={'output': [failed['call']]}) as (local, requests), \
             destination.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            value = fixture.configuration(local, cloud)
            route = value['model_routes']['local-code']
            route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
            route['capabilities'].append('qwen_code_v5')
            value['ai_work'] = {'enabled': True, 'tool_capable_aliases': ['local-code'],
                                'database': str(fixture.fixture.root / 'work.sqlite3')}
            path = fixture.fixture.root / 'v5-progress.json'
            path.write_text(json.dumps(value))
            selected = GatewayConfig.load(path, environ=fixture.fixture.environment).model_routes['local-code']
            with fixture.fixture.connected_client(value) as submit:
                first = submit(headers=headers, request=request)
                self.assertEqual(first['status'], 200, first)
                call = first['body']['output'][0]
                self.assertEqual(call['name'], 'exec_command')
                self.assertEqual(json.loads(call['arguments']), json.loads(failed['call']['arguments']))
                continued = deepcopy(request)
                continued['input'] += [call, deepcopy(failed['result'])]
                original = deepcopy(continued)
                expected = CodexLlamaRequest(continued, harness='qwen-code.v5').value
                preview = json.loads(GatewayRequestHandler._provider_body(continued, selected))
                self.assertEqual(preview['instructions'], expected['instructions'])
                self.assertEqual(preview['input'], expected['input'])
                self.assertEqual(preview['tools'], expected['tools'])
                self.assertTrue(preview['instructions'].startswith(request['instructions']))
                self.assertEqual(preview['tools'], CodexLlamaRequest(continued).value['tools'])
                prefix = preview['input'][:-1]
                self.assertEqual(len(prefix), len(continued['input']))
                self.assertEqual(prefix[0], continued['input'][0])
                self.assertEqual({key: val for key, val in prefix[1].items() if key != 'arguments'},
                                 {key: val for key, val in call.items() if key != 'arguments'})
                self.assertEqual(json.loads(prefix[1]['arguments']), json.loads(call['arguments']))
                self.assertEqual(prefix[2], failed['result'])
                checkpoint = preview['input'][-1]['content'][0]['text']
                self.assertEqual(preview['input'][-1]['role'], 'developer')
                self.assertIn('latest command exit: 1', checkpoint)
                self.assertIn('Completed commands since the last native patch: 1', checkpoint)
                self.assertIn('reports a shell parse error', checkpoint)
                self.assertIn('not proof of correctness', checkpoint)
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

    def test_v5_config_requires_the_exact_local_native_model_and_one_profile(self):
        fixture = app.CodexAppWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        with destination.provider('UNUSED_LOCAL') as (local, requests), \
             destination.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            original = fixture.configuration(local, cloud)
            route = original['model_routes']['local-code']
            route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
            route['capabilities'].append('qwen_code_v5')
            path = fixture.fixture.root / 'v5.json'
            path.write_text(json.dumps(original))
            self.assertIn('qwen_code_v5', GatewayConfig.load(path,
                environ=fixture.fixture.environment).model_routes['local-code'].capabilities)
            for invalid in ['cloud', 'wrong_model', 'missing_transport', 'v1', 'v2', 'v3', 'v4']:
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

    def test_public_setup_accepts_the_explicit_v5_profile_without_qualifying_coding(self):
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
                capabilities=value['model_routes']['local-code']['capabilities'] + ['qwen_code_v5'],
                task_types=['code_change'])
            validate_contract(profile)
            path.write_text(json.dumps(profile))
            self.addCleanup(lambda: f.command('disconnect', check=False))
            f.command('setup', *options)
            configured = GatewayConfig.load(f.path, environ=f.environment)
            selected = configured.model_routes['Qwen3-14B-Q4_K_M']
            self.assertIn('qwen_code_v5', selected.capabilities)
            self.assertFalse(any('qwen_code_v' + str(i) in selected.capabilities for i in range(1, 5)))
            state = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((state['coding_readiness'], state['automatic_task_types']), ('unknown', []))
            self.assertEqual(f.client('code-change')['status'], 503)
            self.assertFalse((engine / 'inference-count').exists())
            f.command('disconnect')
            self.assertEqual(f.client('inspect')['model'], 'original-model')
            self.assertEqual(cloud_requests, [])

    def test_previous_harness_evidence_including_v4_cannot_authorize_v5_coding(self):
        for previous in ('qwen_code_v1', 'qwen_code_v2', 'qwen_code_v3', 'qwen_code_v4'):
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
                    route['capabilities'].append('qwen_code_v5')
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
