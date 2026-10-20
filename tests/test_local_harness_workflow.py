"""Opt-in shaping at connect -> submit -> result -> disconnect."""
from copy import deepcopy
import json
import unittest

from hormuz.config import ConfigError, GatewayConfig
from hormuz.contracts import validate_contract

from tests import test_codex_app_workflow as app
from tests import test_execution_destination_workflow as destination
from tests import test_coding_output_workflow as coding
from tests import test_connected_client_lifetime_workflow as lifetime


class LocalHarnessWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.app = app.CodexAppWorkflowTests()
        self.app.setUp()
        self.addCleanup(self.app.doCleanups)

    def test_only_opted_in_local_route_gets_guidance_and_native_tool_identity_returns(self):
        tool = {'type': 'namespace', 'name': 'mcp__fixture', 'tools': [{
            'type': 'function', 'name': 'echo', 'parameters': {'type': 'object',
                'properties': {'text': {'type': 'string'}}}}]}
        output = [{'type': 'function_call', 'call_id': 'call-1',
                   'name': 'hormuz_mcp__fixture__echo', 'arguments': '{"text":"local"}'}]
        with destination.provider('LOCAL', response_fields={'output': output}) as (local, requests), \
             destination.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            value = self.app.configuration(local, cloud)
            route = value['model_routes']['local-code']
            route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
            route['capabilities'].append('qwen_code_v1')
            with self.app.fixture.connected_client(value) as submit:
                response = submit(request={'input': 'Summarize the fixture.', 'tools': [tool],
                                           'instructions': 'Keep host permissions.'})
                self.assertEqual(response['status'], 200, response)
                self.assertEqual(response['body']['output'][0]['namespace'], 'mcp__fixture')
                self.assertEqual(response['body']['output'][0]['name'], 'echo')
            self.assertTrue(requests[0]['body']['instructions'].startswith('Keep host permissions.'))
            self.assertIn('Read the relevant source', requests[0]['body']['instructions'])
            self.assertEqual(cloud_requests, [])

    def test_capability_rejects_cloud_wrong_model_and_missing_native_transport(self):
        with destination.provider('UNUSED_LOCAL') as (local, requests), \
             destination.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            value = self.app.configuration(local, cloud)
            route = value['model_routes']['local-code']
            route.update(upstream_model='Qwen3-14B-Q4_K_M')
            route['capabilities'].append('qwen_code_v1')
            for change in ('cloud', 'wrong_model', 'missing_transport'):
                with self.subTest(change=change):
                    invalid = deepcopy(value)
                    target = invalid['model_routes']['local-code']
                    if change == 'cloud':
                        target['destination'] = 'openai'
                    elif change == 'wrong_model':
                        target['upstream_model'] = 'another-model'
                    else:
                        target['capabilities'].remove('codex_llama_v1')
                    path = self.app.fixture.root / 'invalid.json'
                    path.write_text(json.dumps(invalid))
                    with self.assertRaises(ConfigError):
                        GatewayConfig.load(path)
            self.assertEqual((requests, cloud_requests), ([], []))

    def test_baseline_coding_receipt_cannot_authorize_the_adapted_route(self):
        fixture = coding.CodingOutputWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        f = fixture.fixture
        with lifetime.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            value, engine, request = fixture.prepare(cloud)
            route = value['model_routes']['local-code']
            route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
            evidence = deepcopy(fixture.evidence(value, request))
            validate_contract(evidence)
            route['capabilities'].append('qwen_code_v1')
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
