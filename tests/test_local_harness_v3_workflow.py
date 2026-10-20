"""New recovery behavior retains destination and coding-evidence boundaries."""
from copy import deepcopy
import json
import unittest

from hormuz.config import ConfigError, GatewayConfig
from hormuz.contracts import validate_contract
from tests import test_codex_app_workflow as app
from tests import test_coding_output_workflow as coding
from tests import test_connected_client_lifetime_workflow as lifetime
from tests import test_execution_destination_workflow as destination


class LocalHarnessV3WorkflowTests(unittest.TestCase):
    def test_v3_config_requires_the_exact_local_native_model_and_one_profile(self):
        fixture = app.CodexAppWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        with destination.provider('UNUSED_LOCAL') as (local, requests), \
             destination.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            original = fixture.configuration(local, cloud)
            route = original['model_routes']['local-code']
            route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
            route['capabilities'].append('qwen_code_v3')
            path = fixture.fixture.root / 'v3.json'
            path.write_text(json.dumps(original))
            self.assertIn('qwen_code_v3', GatewayConfig.load(path,
                environ=fixture.fixture.environment).model_routes['local-code'].capabilities)
            for invalid in ['cloud', 'wrong_model', 'missing_transport', 'v1', 'v2']:
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

    def test_neither_v1_nor_v2_evidence_can_authorize_v3_coding(self):
        for previous in ('qwen_code_v1', 'qwen_code_v2'):
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
                    route['capabilities'].append('qwen_code_v3')
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
