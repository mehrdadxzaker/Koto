"""A correction candidate still blocks ordinary unqualified coding."""
import json
from pathlib import Path
import unittest

from hormuz.config import GatewayConfig
from hormuz.contracts import validate_contract
from tests import test_coding_output_workflow as coding
from tests import test_connected_client_lifetime_workflow as lifetime


class LocalHarnessV11WorkflowTests(unittest.TestCase):
    def test_explicit_setup_reports_unknown_blocks_inference_and_restores_settings(self):
        for version, model in ((11, 'Qwen3-14B-Q4_K_M'),
                (13, 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M'),
                (14, 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M')):
            with self.subTest(version=version):
                self.check_unqualified_setup(version, model)

    def check_unqualified_setup(self, version, model):
        fixture = coding.CodingOutputWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        client = fixture.fixture
        with lifetime.provider('UNUSED_CLOUD') as (cloud, cloud_requests):
            value, engine, _ = fixture.prepare(cloud)
            options = client.local_setup_options(value)
            path = Path(options[1])
            profile = json.loads(path.read_text())
            profile.update(schema_version=5, client_version='0.160.0', coding_evidence=None,
                model=model, max_request_bytes=65536, max_output_tokens=2048,
                capabilities=value['model_routes']['local-code']['capabilities'] + ['qwen_code_v' + str(version)],
                task_types=['code_change'])
            validate_contract(profile)
            path.write_text(json.dumps(profile))
            self.addCleanup(lambda: client.command('disconnect', check=False))
            client.command('setup', *options)
            selected = GatewayConfig.load(client.path, environ=client.environment).model_routes[model]
            self.assertIn('qwen_code_v' + str(version), selected.capabilities)
            state = json.loads(client.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((state['coding_readiness'], state['automatic_task_types']), ('unknown', []))
            self.assertEqual(client.client('code-change')['status'], 503)
            self.assertFalse((engine / 'inference-count').exists())
            client.command('disconnect')
            self.assertEqual(client.client('inspect')['model'], 'original-model')
            self.assertEqual(cloud_requests, [])
