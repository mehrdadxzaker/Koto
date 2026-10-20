"""V2 reaches the existing Codex transport and keeps coding permission explicit."""
from copy import deepcopy
import json
import unittest

from hormuz.codex_llama import CodexLlamaRequest
from hormuz.config import ConfigError, GatewayConfig
from hormuz.contracts import validate_contract
from hormuz.server import GatewayRequestHandler
from tests import test_codex_app_workflow as app
from tests import test_coding_output_workflow as coding
from tests import test_connected_client_lifetime_workflow as lifetime
from tests import test_execution_destination_workflow as destination


class LocalHarnessV2WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.app = app.CodexAppWorkflowTests()
        self.app.setUp()
        self.addCleanup(self.app.doCleanups)

    def configuration(self, local, cloud):
        value = self.app.configuration(local, cloud)
        route = value['model_routes']['local-code']
        route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
        route['capabilities'].append('qwen_code_v2')
        return value

    def test_v2_live_submission_and_provider_body_select_the_same_shape(self):
        tool = {'type': 'namespace', 'name': 'mcp__fixture', 'tools': [{
            'type': 'function', 'name': 'echo', 'parameters': {'type': 'object',
                'properties': {'text': {'type': 'string'}}}}]}
        output = [{'type': 'function_call', 'call_id': 'call-1',
                   'name': 'hormuz_mcp__fixture__echo', 'arguments': '{"text":"local"}'}]
        request = {'input': 'Summarize the fixture.', 'tools': [tool],
                   'instructions': 'Keep host permissions.'}
        with destination.provider('LOCAL', response_fields={'output': output}) as (local, requests), \
             destination.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            value = self.configuration(local, cloud)
            path = self.app.fixture.root / 'v2.json'
            path.write_text(json.dumps(value))
            route = GatewayConfig.load(path, environ=self.app.fixture.environment).model_routes['local-code']
            expected = CodexLlamaRequest(request, harness='qwen-code.v2').value
            body = json.loads(GatewayRequestHandler._provider_body(request, route))
            self.assertEqual(body['instructions'], expected['instructions'])
            self.assertEqual(body['tools'], expected['tools'])
            self.assertEqual(body['input'], expected['input'])
            with self.app.fixture.connected_client(value) as submit:
                response = submit(request=request)
                self.assertEqual(response['status'], 200, response)
                self.assertEqual(response['body']['output'][0]['namespace'], 'mcp__fixture')
                self.assertEqual(response['body']['output'][0]['name'], 'echo')
            self.assertEqual(requests[0]['body']['instructions'], expected['instructions'])
            self.assertEqual(requests[0]['body']['tools'], expected['tools'])
            self.assertEqual(requests[0]['body']['input'], expected['input'])
            self.assertTrue(expected['instructions'].startswith(request['instructions']))
            self.assertNotEqual(expected['instructions'],
                CodexLlamaRequest(request, harness='qwen-code.v1').value['instructions'])
            self.assertEqual(cloud_requests, [])

    def test_v2_rejects_cloud_wrong_model_missing_transport_and_two_profiles(self):
        with destination.provider('UNUSED_LOCAL') as (local, requests), \
             destination.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            original = self.configuration(local, cloud)
            for change in ['cloud', 'wrong_model', 'missing_transport', 'two_profiles']:
                with self.subTest(change=change):
                    value = deepcopy(original)
                    route = value['model_routes']['local-code']
                    if change == 'cloud':
                        route['destination'] = 'openai'
                    elif change == 'wrong_model':
                        route['upstream_model'] = 'another-model'
                    elif change == 'missing_transport':
                        route['capabilities'].remove('codex_llama_v1')
                    else:
                        route['capabilities'].append('qwen_code_v1')
                    path = self.app.fixture.root / 'invalid-v2.json'
                    path.write_text(json.dumps(value))
                    with self.assertRaisesRegex(ConfigError, 'Qwen'):
                        GatewayConfig.load(path, environ=self.app.fixture.environment)
            self.assertEqual((requests, cloud_requests), ([], []))

    def test_v1_coding_evidence_cannot_authorize_the_v2_route(self):
        fixture = coding.CodingOutputWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        f = fixture.fixture
        with lifetime.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            value, engine, request = fixture.prepare(cloud)
            route = value['model_routes']['local-code']
            route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
            route['capabilities'].append('qwen_code_v1')
            evidence = deepcopy(fixture.evidence(value, request))
            validate_contract(evidence)
            route['capabilities'].remove('qwen_code_v1')
            route['capabilities'].append('qwen_code_v2')
            value['route_admission']['local_routes']['local-code']['coding_evidence'] = evidence
            f.path.write_text(json.dumps(value))
            self.addCleanup(lambda: f.command('disconnect', check=False))
            f.command('connect')
            state = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((state['coding_readiness'], state['automatic_task_types']), ('subject_mismatch', []))
            self.assertEqual(f.client('code-change')['status'], 503)
            self.assertFalse((engine / 'inference-count').exists())
            f.command('disconnect')
            self.assertEqual(cloud_requests, [])


if __name__ == '__main__':
    unittest.main()
